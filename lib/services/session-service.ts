import type {
  SessionRepository,
  SessionRow,
  SessionAccessRow,
} from "@/lib/repositories/session-repository";
import type { ClientRepository } from "@/lib/repositories/client-repository";
import type { TeamRepository } from "@/lib/repositories/team-repository";
import type { MasterSignalRepository } from "@/lib/repositories/master-signal-repository";
import { createNewClient, ClientDuplicateError } from "./client-service";
import { getTeamMember } from "./team-service";
import { taintLatestMasterSignal } from "./master-signal-service";
import { SessionNotFoundRepoError } from "@/lib/repositories/supabase/supabase-session-repository";

// ---------------------------------------------------------------------------
// Session Access Check
// ---------------------------------------------------------------------------

export type SessionAccessResult =
  | { allowed: true; userId: string; teamId: string | null }
  | { allowed: false; reason: "unauthenticated" | "not-found" | "forbidden" };

/**
 * Checks whether a user has access to a session.
 * Framework-agnostic — returns a discriminated union, not HTTP responses.
 *
 * - not-found: session does not exist or is soft-deleted
 * - forbidden: team context and user is neither the owner nor an admin
 */
export async function checkSessionAccess(
  sessionRepo: SessionRepository,
  teamRepo: TeamRepository,
  sessionId: string,
  userId: string,
  teamId: string | null
): Promise<SessionAccessResult> {
  console.log(
    `[session-service] checkSessionAccess — userId: ${userId}, sessionId: ${sessionId}, teamId: ${teamId}`
  );

  const session = await sessionRepo.findById(sessionId);

  if (!session) {
    return { allowed: false, reason: "not-found" };
  }

  if (teamId && session.created_by !== userId) {
    const member = await getTeamMember(teamRepo, teamId, userId);
    if (member?.role !== "admin") {
      return { allowed: false, reason: "forbidden" };
    }
  }

  console.log(
    `[session-service] checkSessionAccess — allowed for user ${userId}, session ${sessionId}`
  );
  return { allowed: true, userId, teamId };
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
 * Returns sessions and total count for pagination.
 */
export async function getSessions(
  sessionRepo: SessionRepository,
  filters: SessionFilters,
  teamId: string | null
): Promise<{ sessions: SessionWithClient[]; total: number }> {
  const { clientId, dateFrom, dateTo, offset, limit } = filters;

  console.log(
    "[session-service] getSessions — filters:",
    JSON.stringify(filters),
    "teamId:",
    teamId
  );

  const { rows, total } = await sessionRepo.list({
    clientId,
    dateFrom,
    dateTo,
    offset,
    limit,
  });

  // In team context, resolve creator emails for attribution
  let emailByUserId: Map<string, string> | null = null;
  if (teamId && rows.length > 0) {
    const uniqueUserIds = [...new Set(rows.map((r) => r.created_by))];
    emailByUserId = await sessionRepo.getCreatorEmails(uniqueUserIds);
  }

  // Batch-fetch attachment counts for the returned sessions
  const sessionIds = rows.map((r) => r.id);
  const attachmentCountMap =
    sessionIds.length > 0
      ? await sessionRepo.getAttachmentCounts(sessionIds)
      : new Map<string, number>();

  const sessions: SessionWithClient[] = rows.map((row) => ({
    id: row.id,
    client_id: row.client_id,
    session_date: row.session_date,
    raw_notes: row.raw_notes,
    structured_notes: row.structured_notes ?? null,
    created_by: row.created_by,
    created_at: row.created_at,
    client_name: row.client_name,
    created_by_email: emailByUserId?.get(row.created_by) ?? undefined,
    attachment_count: attachmentCountMap.get(row.id) ?? 0,
  }));

  console.log(
    "[session-service] getSessions — returning",
    sessions.length,
    "of",
    total,
    "total"
  );

  return { sessions, total };
}

/**
 * Create a new feedback session.
 * If clientId is null, creates the client first using clientName.
 * Re-throws ClientDuplicateError so the API route can return 409.
 */
export async function createSession(
  sessionRepo: SessionRepository,
  clientRepo: ClientRepository,
  input: CreateSessionInput
): Promise<Session> {
  const { clientId, clientName, sessionDate, rawNotes, structuredNotes } = input;

  console.log(
    "[session-service] createSession — clientId:",
    clientId,
    "clientName:",
    clientName
  );

  // Resolve the client ID
  let resolvedClientId = clientId;

  if (!resolvedClientId) {
    const newClient = await createNewClient(clientRepo, clientName);
    resolvedClientId = newClient.id;
    console.log("[session-service] created new client:", resolvedClientId);
  }

  const row = await sessionRepo.create({
    client_id: resolvedClientId,
    session_date: sessionDate,
    raw_notes: rawNotes,
    structured_notes: structuredNotes ?? null,
  });

  console.log("[session-service] createSession success:", row.id);
  return mapRowToSession(row);
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
  sessionRepo: SessionRepository,
  clientRepo: ClientRepository,
  id: string,
  input: UpdateSessionInput
): Promise<Session> {
  const { clientId, clientName, sessionDate, rawNotes, structuredNotes } = input;

  console.log("[session-service] updateSession — id:", id, "clientId:", clientId);

  // Resolve the client ID
  let resolvedClientId = clientId;

  if (!resolvedClientId) {
    const newClient = await createNewClient(clientRepo, clientName);
    resolvedClientId = newClient.id;
    console.log("[session-service] updateSession created new client:", resolvedClientId);
  }

  try {
    const row = await sessionRepo.update(id, {
      client_id: resolvedClientId,
      session_date: sessionDate,
      raw_notes: rawNotes,
      structured_notes: structuredNotes,
    });

    console.log("[session-service] updateSession success:", row.id);
    return mapRowToSession(row);
  } catch (err) {
    if (err instanceof SessionNotFoundRepoError) {
      console.warn("[session-service] updateSession not found:", id);
      throw new SessionNotFoundError(err.message);
    }
    throw err;
  }
}

/**
 * Soft-delete a session by setting deleted_at.
 * Throws SessionNotFoundError if the session doesn't exist or is already deleted.
 * Taints the latest master signal if the session had structured notes.
 */
export async function deleteSession(
  sessionRepo: SessionRepository,
  masterSignalRepo: MasterSignalRepository,
  id: string
): Promise<void> {
  console.log("[session-service] deleteSession — id:", id);

  try {
    const result = await sessionRepo.softDelete(id);

    console.log("[session-service] deleteSession success:", result.id);

    if (result.structured_notes) {
      try {
        await taintLatestMasterSignal(
          masterSignalRepo,
          result.created_by,
          result.team_id ?? undefined
        );
      } catch (taintErr) {
        console.error(
          "[session-service] failed to taint master signal:",
          taintErr instanceof Error ? taintErr.message : taintErr
        );
      }
    }
  } catch (err) {
    if (err instanceof SessionNotFoundRepoError) {
      console.warn("[session-service] deleteSession not found:", id);
      throw new SessionNotFoundError(err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapRowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    client_id: row.client_id,
    session_date: row.session_date,
    raw_notes: row.raw_notes,
    structured_notes: row.structured_notes,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

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
