import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createNewClient, ClientDuplicateError } from "./client-service";
import { taintLatestMasterSignal } from "./master-signal-service";

export interface CreateSessionInput {
  clientId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredNotes?: string | null;
}

export interface Session {
  id: string;
  client_id: string;
  session_date: string;
  raw_notes: string;
  structured_notes: string | null;
  created_by: string;
  created_at: string;
}

export interface SessionWithClient extends Session {
  client_name: string;
}

export interface SessionFilters {
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  offset: number;
  limit: number;
}

/**
 * Fetch paginated sessions with optional filters.
 * Joins with clients to include client_name.
 * Returns sessions and total count for pagination.
 */
export async function getSessions(
  filters: SessionFilters
): Promise<{ sessions: SessionWithClient[]; total: number }> {
  const { clientId, dateFrom, dateTo, offset, limit } = filters;

  console.log("[session-service] getSessions — filters:", JSON.stringify(filters));

  const supabase = await createClient();

  // Build the data query with join
  let query = supabase
    .from("sessions")
    .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at, clients(name)", { count: "exact" })
    .is("deleted_at", null)
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (clientId) {
    query = query.eq("client_id", clientId);
  }
  if (dateFrom) {
    query = query.gte("session_date", dateFrom);
  }
  if (dateTo) {
    query = query.lte("session_date", dateTo);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error("[session-service] getSessions error:", error);
    throw new Error("Failed to fetch sessions");
  }

  // Transform the joined data to flatten client_name
  const sessions: SessionWithClient[] = (data ?? []).map((row) => {
    // Supabase returns the joined table as an object (single FK) or array
    const clientData = row.clients as unknown as { name: string } | null;
    return {
      id: row.id,
      client_id: row.client_id,
      session_date: row.session_date,
      raw_notes: row.raw_notes,
      structured_notes: row.structured_notes ?? null,
      created_by: row.created_by,
      created_at: row.created_at,
      client_name: clientData?.name ?? "Unknown",
    };
  });

  console.log("[session-service] getSessions — returning", sessions.length, "of", count, "total");

  return { sessions, total: count ?? 0 };
}

/**
 * Create a new feedback session.
 * If clientId is null, creates the client first using clientName.
 * Re-throws ClientDuplicateError so the API route can return 409.
 */
export async function createSession(
  input: CreateSessionInput
): Promise<Session> {
  const { clientId, clientName, sessionDate, rawNotes, structuredNotes } = input;

  console.log("[session-service] createSession — clientId:", clientId, "clientName:", clientName);

  // Resolve the client ID
  let resolvedClientId = clientId;

  if (!resolvedClientId) {
    // Create the new client — let ClientDuplicateError propagate
    const newClient = await createNewClient(clientName);
    resolvedClientId = newClient.id;
    console.log("[session-service] created new client:", resolvedClientId);
  }

  // Insert the session
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      client_id: resolvedClientId,
      session_date: sessionDate,
      raw_notes: rawNotes,
      structured_notes: structuredNotes ?? null,
    })
    .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at")
    .single();

  if (error) {
    console.error("[session-service] createSession insert error:", error);
    throw new Error("Failed to create session");
  }

  console.log("[session-service] createSession success:", data.id);
  return data;
}

export interface UpdateSessionInput {
  clientId: string | null;
  clientName: string;
  sessionDate: string;
  rawNotes: string;
  structuredNotes?: string | null;
}

/**
 * Update an existing session.
 * Supports changing the client (including to a new client).
 * Throws SessionNotFoundError if the session doesn't exist or is deleted.
 * Re-throws ClientDuplicateError so the API route can return 409.
 */
export async function updateSession(
  id: string,
  input: UpdateSessionInput
): Promise<Session> {
  const { clientId, clientName, sessionDate, rawNotes, structuredNotes } = input;

  console.log("[session-service] updateSession — id:", id, "clientId:", clientId);

  // Resolve the client ID
  let resolvedClientId = clientId;

  if (!resolvedClientId) {
    const newClient = await createNewClient(clientName);
    resolvedClientId = newClient.id;
    console.log("[session-service] updateSession created new client:", resolvedClientId);
  }

  const supabase = await createClient();

  // Build update payload — only include structured_notes if explicitly provided
  // undefined = "don't touch it", null = "clear it", string = "set it"
  const updatePayload: Record<string, unknown> = {
    client_id: resolvedClientId,
    session_date: sessionDate,
    raw_notes: rawNotes,
  };

  if (structuredNotes !== undefined) {
    updatePayload.structured_notes = structuredNotes;
  }

  const { data, error } = await supabase
    .from("sessions")
    .update(updatePayload)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at")
    .single();

  if (error) {
    // PGRST116 = no rows returned (not found or already deleted)
    if (error.code === "PGRST116") {
      console.warn("[session-service] updateSession not found:", id);
      throw new SessionNotFoundError(`Session ${id} not found`);
    }
    console.error("[session-service] updateSession error:", error);
    throw new Error("Failed to update session");
  }

  console.log("[session-service] updateSession success:", data.id);
  return data;
}

/**
 * Soft-delete a session by setting deleted_at.
 * Uses the service role client to bypass the RLS WITH CHECK constraint
 * (which blocks updates that set deleted_at to a non-null value).
 * Throws SessionNotFoundError if the session doesn't exist or is already deleted.
 */
export async function deleteSession(id: string): Promise<void> {
  console.log("[session-service] deleteSession — id:", id);

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select("id, structured_notes, created_by")
    .single();

  if (error) {
    if (error.code === "PGRST116") {
      console.warn("[session-service] deleteSession not found:", id);
      throw new SessionNotFoundError(`Session ${id} not found`);
    }
    console.error("[session-service] deleteSession error:", error);
    throw new Error("Failed to delete session");
  }

  console.log("[session-service] deleteSession success:", data.id);

  // Taint the deleting user's master signal if the session had extracted signals
  if (data.structured_notes) {
    try {
      await taintLatestMasterSignal(data.created_by);
    } catch (taintErr) {
      console.error(
        "[session-service] failed to taint master signal:",
        taintErr instanceof Error ? taintErr.message : taintErr
      );
    }
  }
}

/**
 * Custom error for sessions that don't exist or are already deleted.
 */
export class SessionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionNotFoundError";
  }
}

export { ClientDuplicateError };
