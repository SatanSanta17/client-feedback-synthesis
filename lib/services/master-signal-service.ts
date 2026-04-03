import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MasterSignal {
  id: string;
  content: string;
  generatedAt: string;
  sessionsIncluded: number;
  createdBy: string;
  createdAt: string;
  isTainted: boolean;
}

export interface SignalSession {
  id: string;
  clientName: string;
  sessionDate: string;
  structuredNotes: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Fetch the latest master signal (most recent by generated_at).
 * Scopes by active workspace: personal (team_id IS NULL) or team.
 * Returns null if no master signal has been generated yet.
 */
export async function getLatestMasterSignal(): Promise<MasterSignal | null> {
  const teamId = await getActiveTeamId();
  console.log("[master-signal-service] getLatestMasterSignal — teamId:", teamId);

  const supabase = await createClient();

  let query = supabase
    .from("master_signals")
    .select("id, content, generated_at, sessions_included, created_by, created_at, is_tainted")
    .order("generated_at", { ascending: false })
    .limit(1);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("[master-signal-service] getLatestMasterSignal error:", error);
    throw new Error("Failed to fetch master signal");
  }

  if (!data) {
    console.log("[master-signal-service] getLatestMasterSignal — none found");
    return null;
  }

  console.log("[master-signal-service] getLatestMasterSignal — found:", data.id);

  return {
    id: data.id,
    content: data.content,
    generatedAt: data.generated_at,
    sessionsIncluded: data.sessions_included,
    createdBy: data.created_by,
    createdAt: data.created_at,
    isTainted: data.is_tainted,
  };
}

/**
 * Count sessions that have structured_notes and were updated after the given
 * timestamp. Scopes by active workspace.
 *
 * If `since` is null, counts ALL sessions with structured_notes (useful when
 * no master signal exists yet).
 */
export async function getStaleSessionCount(
  since: string | null
): Promise<number> {
  const teamId = await getActiveTeamId();
  console.log("[master-signal-service] getStaleSessionCount — since:", since, "teamId:", teamId);

  const supabase = await createClient();

  let query = supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .not("structured_notes", "is", null)
    .is("deleted_at", null);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  if (since) {
    query = query.gt("updated_at", since);
  }

  const { count, error } = await query;

  if (error) {
    console.error("[master-signal-service] getStaleSessionCount error:", error);
    throw new Error("Failed to count stale sessions");
  }

  const result = count ?? 0;
  console.log("[master-signal-service] getStaleSessionCount —", result);
  return result;
}

/**
 * Fetch all non-deleted sessions with structured_notes, joined with client
 * names. Scopes by active workspace. Used for cold-start generation.
 */
export async function getAllSignalSessions(): Promise<SignalSession[]> {
  const teamId = await getActiveTeamId();
  console.log("[master-signal-service] getAllSignalSessions — teamId:", teamId);

  const supabase = await createClient();

  let query = supabase
    .from("sessions")
    .select("id, session_date, structured_notes, updated_at, clients(name)")
    .not("structured_notes", "is", null)
    .is("deleted_at", null)
    .order("session_date", { ascending: true });

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[master-signal-service] getAllSignalSessions error:", error);
    throw new Error("Failed to fetch signal sessions");
  }

  const sessions = (data ?? []).map(mapSessionRow);

  console.log(
    "[master-signal-service] getAllSignalSessions —",
    sessions.length,
    "sessions"
  );
  return sessions;
}

/**
 * Fetch sessions with structured_notes that were updated after the given
 * timestamp. Scopes by active workspace. Used for incremental generation.
 */
export async function getSignalSessionsSince(
  since: string
): Promise<SignalSession[]> {
  const teamId = await getActiveTeamId();
  console.log("[master-signal-service] getSignalSessionsSince — since:", since, "teamId:", teamId);

  const supabase = await createClient();

  let query = supabase
    .from("sessions")
    .select("id, session_date, structured_notes, updated_at, clients(name)")
    .not("structured_notes", "is", null)
    .is("deleted_at", null)
    .gt("updated_at", since)
    .order("session_date", { ascending: true });

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data, error } = await query;

  if (error) {
    console.error(
      "[master-signal-service] getSignalSessionsSince error:",
      error
    );
    throw new Error("Failed to fetch signal sessions");
  }

  const sessions = (data ?? []).map(mapSessionRow);

  console.log(
    "[master-signal-service] getSignalSessionsSince —",
    sessions.length,
    "sessions"
  );
  return sessions;
}

/**
 * Persist a new master signal generation. Inserts a new immutable row.
 * Scopes by active workspace — includes team_id when in team context.
 */
export async function saveMasterSignal(
  content: string,
  sessionsIncluded: number
): Promise<MasterSignal> {
  const teamId = await getActiveTeamId();
  console.log(
    "[master-signal-service] saveMasterSignal —",
    sessionsIncluded,
    "sessions included, teamId:",
    teamId
  );

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("master_signals")
    .insert({
      content,
      sessions_included: sessionsIncluded,
      generated_at: new Date().toISOString(),
      team_id: teamId,
    })
    .select("id, content, generated_at, sessions_included, created_by, created_at, is_tainted")
    .single();

  if (error) {
    console.error("[master-signal-service] saveMasterSignal error:", error);
    throw new Error("Failed to save master signal");
  }

  console.log("[master-signal-service] saveMasterSignal success:", data.id);

  return {
    id: data.id,
    content: data.content,
    generatedAt: data.generated_at,
    sessionsIncluded: data.sessions_included,
    createdBy: data.created_by,
    createdAt: data.created_at,
    isTainted: data.is_tainted,
  };
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Mark the latest master signal as tainted (contains data from a now-deleted
 * session). Scopes by teamId when provided (team context), otherwise by userId
 * (personal context). No-op if no master signal exists or if already tainted.
 * Uses the service role client to bypass RLS.
 */
export async function taintLatestMasterSignal(userId: string, teamId?: string): Promise<void> {
  console.log("[master-signal-service] taintLatestMasterSignal — userId:", userId, "teamId:", teamId);

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("master_signals")
    .select("id, is_tainted")
    .order("generated_at", { ascending: false })
    .limit(1);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.eq("created_by", userId).is("team_id", null);
  }

  const { data: latest, error: fetchError } = await query.maybeSingle();

  if (fetchError) {
    console.error(
      "[master-signal-service] taintLatestMasterSignal fetch error:",
      fetchError
    );
    throw new Error("Failed to fetch latest master signal for tainting");
  }

  if (!latest) {
    console.log(
      "[master-signal-service] taintLatestMasterSignal — no master signal exists, skipping"
    );
    return;
  }

  if (latest.is_tainted) {
    console.log(
      "[master-signal-service] taintLatestMasterSignal — already tainted, skipping"
    );
    return;
  }

  const { error: updateError } = await supabase
    .from("master_signals")
    .update({ is_tainted: true })
    .eq("id", latest.id);

  if (updateError) {
    console.error(
      "[master-signal-service] taintLatestMasterSignal update error:",
      updateError
    );
    throw new Error("Failed to taint master signal");
  }

  console.log(
    "[master-signal-service] taintLatestMasterSignal — tainted:",
    latest.id
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a raw Supabase session row (with joined client) to a SignalSession.
 */
function mapSessionRow(row: {
  id: string;
  session_date: string;
  structured_notes: string | null;
  updated_at: string;
  clients: unknown;
}): SignalSession {
  const clientData = row.clients as { name: string } | null;
  return {
    id: row.id,
    clientName: clientData?.name ?? "Unknown",
    sessionDate: row.session_date,
    structuredNotes: row.structured_notes ?? "",
    updatedAt: row.updated_at,
  };
}
