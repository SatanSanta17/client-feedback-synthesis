// ---------------------------------------------------------------------------
// Session Repository Interface
// ---------------------------------------------------------------------------

export interface SessionListFilters {
  clientId?: string;
  dateFrom?: string;
  dateTo?: string;
  offset: number;
  limit: number;
}

/** Raw row shape returned by list queries (before service-layer mapping). */
export interface SessionRow {
  id: string;
  client_id: string;
  session_date: string;
  raw_notes: string;
  structured_notes: string | null;
  created_by: string;
  created_at: string;
  client_name: string;
}

export interface SessionInsert {
  client_id: string;
  session_date: string;
  raw_notes: string;
  structured_notes: string | null;
}

export interface SessionUpdate {
  client_id: string;
  session_date: string;
  raw_notes: string;
  structured_notes?: string | null;
}

export interface SessionDeleteResult {
  id: string;
  structured_notes: string | null;
  created_by: string;
  team_id: string | null;
}

export interface SessionAccessRow {
  id: string;
  created_by: string;
}

// ---------------------------------------------------------------------------
// Repo-level error for "not found" — the service layer catches and re-wraps.
// ---------------------------------------------------------------------------

export class SessionNotFoundRepoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionNotFoundRepoError";
  }
}

export interface SessionRepository {
  /** Paginated list with optional filters. Returns rows + total count. */
  list(filters: SessionListFilters): Promise<{ rows: SessionRow[]; total: number }>;

  /** Find a session by ID (non-deleted only). Used for access checks. */
  findById(sessionId: string): Promise<SessionAccessRow | null>;

  /** Insert a new session. Returns the created row. */
  create(input: SessionInsert): Promise<SessionRow>;

  /** Update a session by ID. Returns the updated row. Throws if not found. */
  update(id: string, input: SessionUpdate): Promise<SessionRow>;

  /** Soft-delete a session by ID. Returns metadata for post-delete side effects. Throws if not found. */
  softDelete(id: string): Promise<SessionDeleteResult>;

  /** Batch-fetch attachment counts for a list of session IDs. */
  getAttachmentCounts(sessionIds: string[]): Promise<Map<string, number>>;

  /** Batch-fetch creator emails for a list of user IDs. */
  getCreatorEmails(userIds: string[]): Promise<Map<string, string>>;
}
