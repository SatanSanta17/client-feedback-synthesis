import { type SupabaseClient } from "@supabase/supabase-js";

import type { SessionRepository } from "../session-repository";

export function createSessionRepository(
  supabase: SupabaseClient,
  _serviceClient: SupabaseClient,
  _teamId: string | null
): SessionRepository {
  return {
    async list(_filters) {
      void supabase;
      throw new Error("Not implemented");
    },
    async findById(_sessionId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async create(_input) {
      void supabase;
      throw new Error("Not implemented");
    },
    async update(_id, _input) {
      void supabase;
      throw new Error("Not implemented");
    },
    async softDelete(_id) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getAttachmentCounts(_sessionIds) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getCreatorEmails(_userIds) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
