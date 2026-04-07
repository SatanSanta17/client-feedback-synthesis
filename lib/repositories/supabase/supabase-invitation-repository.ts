import { type SupabaseClient } from "@supabase/supabase-js";

import type { InvitationRepository } from "../invitation-repository";

export function createInvitationRepository(
  supabase: SupabaseClient,
  _serviceClient: SupabaseClient
): InvitationRepository {
  return {
    async create(_invitation) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getAllForTeam(_teamId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getPending(_teamId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async revoke(_teamId, _invitationId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async refreshToken(_teamId, _invitationId, _newToken, _newExpiresAt) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getByToken(_token) {
      void supabase;
      throw new Error("Not implemented");
    },
    async isUserTeamMember(_teamId, _userId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async addTeamMember(_teamId, _userId, _role) {
      void supabase;
      throw new Error("Not implemented");
    },
    async markAccepted(_invitationId) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
