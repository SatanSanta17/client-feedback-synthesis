import { type SupabaseClient } from "@supabase/supabase-js";

import type { ClientRepository } from "../client-repository";

export function createClientRepository(
  supabase: SupabaseClient,
  _teamId: string | null
): ClientRepository {
  return {
    async search(_query, _limit) {
      void supabase;
      throw new Error("Not implemented");
    },
    async searchWithSessions(_query, _limit) {
      void supabase;
      throw new Error("Not implemented");
    },
    async create(_name) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
