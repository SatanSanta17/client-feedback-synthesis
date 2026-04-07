import { type SupabaseClient } from "@supabase/supabase-js";

import type { ProfileRepository } from "../profile-repository";

export function createProfileRepository(
  supabase: SupabaseClient
): ProfileRepository {
  return {
    async getByUserId(userId) {
      console.log("[supabase-profile-repo] getByUserId — userId:", userId);

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

      if (error) {
        console.error("[supabase-profile-repo] getByUserId error:", error.message);
        return null;
      }

      return data;
    },
  };
}
