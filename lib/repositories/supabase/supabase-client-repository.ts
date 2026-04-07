import { type SupabaseClient } from "@supabase/supabase-js";

import type { ClientRepository } from "../client-repository";
import { scopeByTeam } from "./scope-by-team";

export function createClientRepository(
  supabase: SupabaseClient,
  teamId: string | null
): ClientRepository {
  return {
    async search(query, limit) {
      console.log("[supabase-client-repo] search — query:", JSON.stringify(query), "teamId:", teamId);

      let request = supabase
        .from("clients")
        .select("id, name")
        .order("name", { ascending: true })
        .limit(limit);

      request = scopeByTeam(request, teamId);

      if (query.trim().length > 0) {
        request = request.ilike("name", `%${query.trim()}%`);
      }

      const { data, error } = await request;

      if (error) {
        console.error("[supabase-client-repo] search error:", error);
        throw new Error("Failed to search clients");
      }

      return data ?? [];
    },

    async searchWithSessions(query, limit) {
      console.log("[supabase-client-repo] searchWithSessions — query:", JSON.stringify(query), "teamId:", teamId);

      // Step 1: Get client IDs that have at least one non-deleted session
      let sessionQuery = supabase
        .from("sessions")
        .select("client_id")
        .is("deleted_at", null);

      sessionQuery = scopeByTeam(sessionQuery, teamId);

      const { data: sessionClientIds, error: sessionError } = await sessionQuery;

      if (sessionError) {
        console.error("[supabase-client-repo] searchWithSessions sessionClientIds error:", sessionError);
        throw new Error("Failed to search clients");
      }

      const uniqueClientIds = [...new Set((sessionClientIds ?? []).map((s) => s.client_id))];

      if (uniqueClientIds.length === 0) {
        return [];
      }

      // Step 2: Search within those clients
      let request = supabase
        .from("clients")
        .select("id, name")
        .in("id", uniqueClientIds)
        .order("name", { ascending: true })
        .limit(limit);

      if (query.trim().length > 0) {
        request = request.ilike("name", `%${query.trim()}%`);
      }

      const { data, error } = await request;

      if (error) {
        console.error("[supabase-client-repo] searchWithSessions error:", error);
        throw new Error("Failed to search clients");
      }

      return data ?? [];
    },

    async create(name) {
      console.log("[supabase-client-repo] create — name:", name, "teamId:", teamId);

      const { data, error } = await supabase
        .from("clients")
        .insert({ name: name.trim(), team_id: teamId })
        .select("id, name")
        .single();

      if (error) {
        // Let the error propagate — the service layer handles error code mapping
        console.error("[supabase-client-repo] create error:", error);
        throw error;
      }

      console.log("[supabase-client-repo] create success:", data.id, data.name);
      return data;
    },
  };
}
