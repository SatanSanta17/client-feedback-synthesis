import { createClient } from "@/lib/supabase/server";

/**
 * Search clients by name (case-insensitive partial match).
 * Returns up to 50 matching non-deleted clients, sorted alphabetically.
 *
 * When `hasSession` is true, only returns clients that have at least one
 * non-deleted session. Used by the filter combobox in the past sessions table.
 */
export async function searchClients(
  query: string,
  hasSession?: boolean
): Promise<Array<{ id: string; name: string }>> {
  const supabase = await createClient();

  // When filtering to clients with sessions, first get the distinct client IDs
  // from sessions, then filter clients by those IDs.
  if (hasSession) {
    const { data: sessionClientIds, error: sessionError } = await supabase
      .from("sessions")
      .select("client_id")
      .is("deleted_at", null);

    if (sessionError) {
      console.error("[client-service] searchClients sessionClientIds error:", sessionError);
      throw new Error("Failed to search clients");
    }

    const uniqueClientIds = [...new Set((sessionClientIds ?? []).map((s) => s.client_id))];

    if (uniqueClientIds.length === 0) {
      return [];
    }

    let request = supabase
      .from("clients")
      .select("id, name")
      .in("id", uniqueClientIds)
      .order("name", { ascending: true })
      .limit(50);

    if (query.trim().length > 0) {
      request = request.ilike("name", `%${query.trim()}%`);
    }

    const { data, error } = await request;

    if (error) {
      console.error("[client-service] searchClients error:", error);
      throw new Error("Failed to search clients");
    }

    return data ?? [];
  }

  // Default: return all clients matching the query
  let request = supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(50);

  if (query.trim().length > 0) {
    request = request.ilike("name", `%${query.trim()}%`);
  }

  const { data, error } = await request;

  if (error) {
    console.error("[client-service] searchClients error:", error);
    throw new Error("Failed to search clients");
  }

  return data ?? [];
}

/**
 * Create a new client with the given name.
 * Throws if a client with the same name (case-insensitive) already exists.
 */
export async function createNewClient(
  name: string
): Promise<{ id: string; name: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("clients")
    .insert({ name: name.trim() })
    .select("id, name")
    .single();

  if (error) {
    // Unique constraint violation on case-insensitive name
    if (error.code === "23505") {
      console.warn(
        "[client-service] createNewClient duplicate name:",
        name
      );
      throw new ClientDuplicateError(
        `A client named "${name.trim()}" already exists`
      );
    }

    console.error("[client-service] createNewClient error:", error);
    throw new Error("Failed to create client");
  }

  console.log("[client-service] createNewClient success:", data.id, data.name);
  return data;
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
