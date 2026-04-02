import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

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
 * Returns null if no master signal has been generated yet.
 */
export async function getLatestMasterSignal(): Promise<MasterSignal | null> {
  console.log("[master-signal-service] getLatestMasterSignal");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("master_signals")
    .select("id, content, generated_at, sessions_included, created_by, created_at, is_tainted")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
 * timestamp. Used to determine staleness of the current master signal.
 *
 * If `since` is null, counts ALL sessions with structured_notes (useful when
 * no master signal exists yet).
 */
export async function getStaleSessionCount(
  since: string | null
): Promise<number> {
  console.log("[master-signal-service] getStaleSessionCount — since:", since);

  const supabase = await createClient();

  let query = supabase
    .from("sessions")
    .select("id", { count: "exact", head: true })
    .not("structured_notes", "is", null)
    .is("deleted_at", null);

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
 * names. Used for cold-start generation (no previous master signal).
 */
export async function getAllSignalSessions(): Promise<SignalSession[]> {
  console.log("[master-signal-service] getAllSignalSessions");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sessions")
    .select("id, session_date, structured_notes, updated_at, clients(name)")
    .not("structured_notes", "is", null)
    .is("deleted_at", null)
    .order("session_date", { ascending: true });

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
 * timestamp. Used for incremental generation.
 */
export async function getSignalSessionsSince(
  since: string
): Promise<SignalSession[]> {
  console.log("[master-signal-service] getSignalSessionsSince — since:", since);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sessions")
    .select("id, session_date, structured_notes, updated_at, clients(name)")
    .not("structured_notes", "is", null)
    .is("deleted_at", null)
    .gt("updated_at", since)
    .order("session_date", { ascending: true });

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
 */
export async function saveMasterSignal(
  content: string,
  sessionsIncluded: number
): Promise<MasterSignal> {
  console.log(
    "[master-signal-service] saveMasterSignal —",
    sessionsIncluded,
    "sessions included"
  );

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("master_signals")
    .insert({
      content,
      sessions_included: sessionsIncluded,
      generated_at: new Date().toISOString(),
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
 * session). No-op if no master signal exists or if already tainted.
 * Uses the service role client to bypass RLS.
 */
export async function taintLatestMasterSignal(): Promise<void> {
  console.log("[master-signal-service] taintLatestMasterSignal");

  const supabase = createServiceRoleClient();

  // Find the latest master signal
  const { data: latest, error: fetchError } = await supabase
    .from("master_signals")
    .select("id, is_tainted")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
