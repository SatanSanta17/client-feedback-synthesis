import { type SupabaseClient } from "@supabase/supabase-js";

import type { MasterSignalRepository } from "../master-signal-repository";

export function createMasterSignalRepository(
  supabase: SupabaseClient,
  _serviceClient: SupabaseClient,
  _teamId: string | null
): MasterSignalRepository {
  return {
    async getLatest() {
      void supabase;
      throw new Error("Not implemented");
    },
    async getStaleSessionCount(_since) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getAllSignalSessions() {
      void supabase;
      throw new Error("Not implemented");
    },
    async getSignalSessionsSince(_since) {
      void supabase;
      throw new Error("Not implemented");
    },
    async save(_content, _sessionsIncluded) {
      void supabase;
      throw new Error("Not implemented");
    },
    async taintLatest(_userId, _teamId) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
