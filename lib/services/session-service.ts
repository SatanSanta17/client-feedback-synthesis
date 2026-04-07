import { type SupabaseClient } from "@supabase/supabase-js";

import { createClient, createServiceRoleClient, getActiveTeamId } from "@/lib/supabase/server";
import { createNewClient, ClientDuplicateError } from "./client-service";
import { createClientRepository } from "@/lib/repositories/supabase/supabase-client-repository";
import { getTeamMember } from "./team-service";
import { taintLatestMasterSignal } from "./master-signal-service";

// ---------------------------------------------------------------------------
// Session Access Check
// ---------------------------------------------------------------------------

export type SessionAccessResult =
  | { allowed: true; userId: string; teamId: string | null }
  | { allowed: false; reason: "unauthenticated" | "not-found" | "forbidden" };

/**
 * Checks whether the current user has access to a session.
 * Framework-agnostic — returns a discriminated union, not HTTP responses.
 *
 * - unauthenticated: no valid user session
 * - not-found: session does not exist or is soft-deleted
 * - forbidden: team context and user is neither the owner nor an admin
 */
export async function checkSessionAccess(
  supabase: SupabaseClient,
  sessionId: string
): Promise<SessionAccessResult> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { allowed: false, reason: "unauthenticated" };
  }

  const teamId = await getActiveTeamId();

  const { data: session } = await supabase
    .from("sessions")
    .select("id, created_by")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single();

  if (!session) {
    return { allowed: false, reason: "not-found" };
  }

  if (teamId && session.created_by !== user.id) {
    const member = await getTeamMember(teamId, user.id);
    if (member?.role !== "admin") {
      return { allowed: false, reason: "forbidden" };
    }
  }

  console.log(`[session-service] checkSessionAccess — allowed for user ${user.id}, session ${sessionId}`);
  return { allowed: true, userId: user.id, teamId };
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

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
  created_by_email?: string;
  attachment_count: number;
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
 * Scopes by active workspace: personal (team_id IS NULL) or team.
 * Returns sessions and total count for pagination.
 */
export async function getSessions(
  filters: SessionFilters
): Promise<{ sessions: SessionWithClient[]; total: number }> {
  const { clientId, dateFrom, dateTo, offset, limit } = filters;
  const teamId = await getActiveTeamId();

  console.log("[session-service] getSessions — filters:", JSON.stringify(filters), "teamId:", teamId);

  const supabase = await createClient();

  let query = supabase
    .from("sessions")
    .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at, clients(name)", { count: "exact" })
    .is("deleted_at", null)
    .order("session_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

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

  const rows = data ?? [];

  // In team context, resolve creator emails for attribution
  let emailByUserId: Map<string, string> | null = null;
  if (teamId && rows.length > 0) {
    const uniqueUserIds = [...new Set(rows.map((r) => r.created_by))];
    const serviceClient = createServiceRoleClient();
    const { data: profiles } = await serviceClient
      .from("profiles")
      .select("id, email")
      .in("id", uniqueUserIds);

    emailByUserId = new Map(
      (profiles ?? []).map((p) => [p.id, p.email])
    );
  }

  // Batch-fetch attachment counts for the returned sessions
  const attachmentCountMap = new Map<string, number>();
  const sessionIds = rows.map((r) => r.id);

  if (sessionIds.length > 0) {
    const { data: attachmentRows } = await supabase
      .from("session_attachments")
      .select("session_id")
      .in("session_id", sessionIds)
      .is("deleted_at", null);

    for (const row of attachmentRows ?? []) {
      attachmentCountMap.set(
        row.session_id,
        (attachmentCountMap.get(row.session_id) ?? 0) + 1
      );
    }
  }

  const sessions: SessionWithClient[] = rows.map((row) => {
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
      created_by_email: emailByUserId?.get(row.created_by) ?? undefined,
      attachment_count: attachmentCountMap.get(row.id) ?? 0,
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

  const supabase = await createClient();
  const teamId = await getActiveTeamId();

  if (!resolvedClientId) {
    // Create the new client — let ClientDuplicateError propagate
    const clientRepo = createClientRepository(supabase, teamId);
    const newClient = await createNewClient(clientRepo, clientName);
    resolvedClientId = newClient.id;
    console.log("[session-service] created new client:", resolvedClientId);
  }

  const { data, error } = await supabase
    .from("sessions")
    .insert({
      client_id: resolvedClientId,
      session_date: sessionDate,
      raw_notes: rawNotes,
      structured_notes: structuredNotes ?? null,
      team_id: teamId,
    })
    .select("id, client_id, session_date, raw_notes, structured_notes, created_by, created_at")
    .single();

  if (error) {
    console.error("[session-service] createSession insert error:", error);
    throw new Error("Failed to create session");
  }

  console.log("[session-service] createSession success:", data.id, "teamId:", teamId);
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

  const supabase = await createClient();

  if (!resolvedClientId) {
    const teamId = await getActiveTeamId();
    const clientRepo = createClientRepository(supabase, teamId);
    const newClient = await createNewClient(clientRepo, clientName);
    resolvedClientId = newClient.id;
    console.log("[session-service] updateSession created new client:", resolvedClientId);
  }

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
    .select("id, structured_notes, created_by, team_id")
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

  if (data.structured_notes) {
    try {
      await taintLatestMasterSignal(data.created_by, data.team_id ?? undefined);
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
