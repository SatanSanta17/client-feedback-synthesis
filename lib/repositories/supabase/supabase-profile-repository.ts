import { type SupabaseClient } from "@supabase/supabase-js";

import type { ProfileRepository } from "../profile-repository";

export function createProfileRepository(
  supabase: SupabaseClient
): ProfileRepository {
  return {
    async getByUserId(_userId) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
