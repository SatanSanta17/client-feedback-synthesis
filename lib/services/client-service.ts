import type { ClientRepository } from "@/lib/repositories/client-repository";

/**
 * Search clients by name (case-insensitive partial match).
 * Returns up to 50 matching non-deleted clients, sorted alphabetically.
 *
 * When `hasSession` is true, only returns clients that have at least one
 * non-deleted session. Used by the filter combobox in the past sessions table.
 */
export async function searchClients(
  repo: ClientRepository,
  query: string,
  hasSession?: boolean
): Promise<Array<{ id: string; name: string }>> {
  console.log("[client-service] searchClients — query:", JSON.stringify(query), "hasSession:", hasSession);

  const clients = hasSession
    ? await repo.searchWithSessions(query, 50)
    : await repo.search(query, 50);

  console.log("[client-service] searchClients — returning", clients.length, "clients");
  return clients;
}

/**
 * Create a new client with the given name.
 * Throws ClientDuplicateError if a client with the same name already exists.
 */
export async function createNewClient(
  repo: ClientRepository,
  name: string
): Promise<{ id: string; name: string }> {
  console.log("[client-service] createNewClient — name:", name);

  try {
    const client = await repo.create(name);
    console.log("[client-service] createNewClient success:", client.id, client.name);
    return client;
  } catch (err: unknown) {
    // Supabase unique constraint violation
    if (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505") {
      throw new ClientDuplicateError(
        `A client named "${name.trim()}" already exists`
      );
    }
    throw err;
  }
}

/**
 * Custom error for duplicate client names.
 * Allows the API route to distinguish duplicates from other errors.
 */
export class ClientDuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientDuplicateError";
  }
}
