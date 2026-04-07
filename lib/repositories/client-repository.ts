// ---------------------------------------------------------------------------
// Client Repository Interface
// ---------------------------------------------------------------------------

export interface ClientRow {
  id: string;
  name: string;
}

export interface ClientRepository {
  /** Search clients by name (case-insensitive partial match), scoped by workspace. */
  search(query: string, limit: number): Promise<ClientRow[]>;

  /** Search clients that have at least one non-deleted session, scoped by workspace. */
  searchWithSessions(query: string, limit: number): Promise<ClientRow[]>;

  /** Create a new client. Throws on duplicate name (constraint violation). */
  create(name: string): Promise<ClientRow>;
}
