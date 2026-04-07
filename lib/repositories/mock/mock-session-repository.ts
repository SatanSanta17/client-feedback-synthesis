// ---------------------------------------------------------------------------
// Mock Session Repository — In-memory implementation for testing
// ---------------------------------------------------------------------------
// Demonstrates that service functions work identically with a non-Supabase
// backend. All data is stored in a Map and lost when the instance is disposed.
// ---------------------------------------------------------------------------

import {
  SessionNotFoundRepoError,
  type SessionRepository,
  type SessionListFilters,
  type SessionRow,
  type SessionInsert,
  type SessionUpdate,
  type SessionDeleteResult,
  type SessionAccessRow,
} from "../session-repository";

interface InternalSession {
  id: string;
  client_id: string;
  session_date: string;
  raw_notes: string;
  structured_notes: string | null;
  created_by: string;
  created_at: string;
  client_name: string;
  team_id: string | null;
  deleted_at: string | null;
}

/** Configuration for seeding a mock repository with known data. */
export interface MockSessionSeed {
  sessions?: InternalSession[];
  /** Map of sessionId → attachment count (defaults to 0 for all). */
  attachmentCounts?: Map<string, number>;
  /** Map of userId → email (defaults to "unknown@test.local" for all). */
  creatorEmails?: Map<string, string>;
}

let autoId = 0;
function nextId(): string {
  autoId += 1;
  return `mock-session-${autoId}`;
}

/**
 * Creates an in-memory `SessionRepository` for testing.
 *
 * Supports all CRUD operations, filtering, pagination, and soft-delete — the
 * same contract as the Supabase adapter, backed entirely by a `Map`.
 */
export function createMockSessionRepository(
  seed?: MockSessionSeed,
): SessionRepository {
  const sessions = new Map<string, InternalSession>();
  const attachmentCounts = seed?.attachmentCounts ?? new Map<string, number>();
  const creatorEmails = seed?.creatorEmails ?? new Map<string, string>();

  // Seed initial data
  if (seed?.sessions) {
    for (const s of seed.sessions) {
      sessions.set(s.id, { ...s });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function activeRows(): InternalSession[] {
    return Array.from(sessions.values()).filter((s) => s.deleted_at === null);
  }

  function toSessionRow(s: InternalSession): SessionRow {
    return {
      id: s.id,
      client_id: s.client_id,
      session_date: s.session_date,
      raw_notes: s.raw_notes,
      structured_notes: s.structured_notes,
      created_by: s.created_by,
      created_at: s.created_at,
      client_name: s.client_name,
    };
  }

  // -------------------------------------------------------------------------
  // Repository implementation
  // -------------------------------------------------------------------------

  return {
    async list(filters: SessionListFilters) {
      let rows = activeRows();

      // Apply optional filters
      if (filters.clientId) {
        rows = rows.filter((r) => r.client_id === filters.clientId);
      }
      if (filters.dateFrom) {
        rows = rows.filter((r) => r.session_date >= filters.dateFrom!);
      }
      if (filters.dateTo) {
        rows = rows.filter((r) => r.session_date <= filters.dateTo!);
      }

      // Sort newest-first (matches Supabase adapter behaviour)
      rows.sort(
        (a, b) =>
          new Date(b.session_date).getTime() -
          new Date(a.session_date).getTime(),
      );

      const total = rows.length;

      // Paginate
      const paged = rows.slice(filters.offset, filters.offset + filters.limit);

      return { rows: paged.map(toSessionRow), total };
    },

    async findById(sessionId: string): Promise<SessionAccessRow | null> {
      const s = sessions.get(sessionId);
      if (!s || s.deleted_at !== null) return null;
      return { id: s.id, created_by: s.created_by };
    },

    async create(input: SessionInsert): Promise<SessionRow> {
      const id = nextId();
      const now = new Date().toISOString();
      const internal: InternalSession = {
        id,
        client_id: input.client_id,
        session_date: input.session_date,
        raw_notes: input.raw_notes,
        structured_notes: input.structured_notes,
        created_by: "mock-user",
        created_at: now,
        client_name: `Client ${input.client_id}`,
        team_id: null,
        deleted_at: null,
      };
      sessions.set(id, internal);
      return toSessionRow(internal);
    },

    async update(id: string, input: SessionUpdate): Promise<SessionRow> {
      const s = sessions.get(id);
      if (!s || s.deleted_at !== null) {
        throw new SessionNotFoundRepoError(`Session ${id} not found`);
      }

      s.client_id = input.client_id;
      s.session_date = input.session_date;
      s.raw_notes = input.raw_notes;
      if (input.structured_notes !== undefined) {
        s.structured_notes = input.structured_notes;
      }

      return toSessionRow(s);
    },

    async softDelete(id: string): Promise<SessionDeleteResult> {
      const s = sessions.get(id);
      if (!s || s.deleted_at !== null) {
        throw new SessionNotFoundRepoError(`Session ${id} not found`);
      }

      s.deleted_at = new Date().toISOString();

      return {
        id: s.id,
        structured_notes: s.structured_notes,
        created_by: s.created_by,
        team_id: s.team_id,
      };
    },

    async getAttachmentCounts(
      sessionIds: string[],
    ): Promise<Map<string, number>> {
      const result = new Map<string, number>();
      for (const sid of sessionIds) {
        result.set(sid, attachmentCounts.get(sid) ?? 0);
      }
      return result;
    },

    async getCreatorEmails(userIds: string[]): Promise<Map<string, string>> {
      const result = new Map<string, string>();
      for (const uid of userIds) {
        result.set(uid, creatorEmails.get(uid) ?? "unknown@test.local");
      }
      return result;
    },
  };
}
