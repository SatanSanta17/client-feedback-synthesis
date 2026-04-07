import { type SupabaseClient } from "@supabase/supabase-js";

import type { TeamRepository } from "../team-repository";

export function createTeamRepository(
  supabase: SupabaseClient,
  _serviceClient: SupabaseClient
): TeamRepository {
  return {
    async create(_name, _userId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getById(_teamId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getForUser() {
      void supabase;
      throw new Error("Not implemented");
    },
    async getWithRolesForUser(_userId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getMember(_teamId, _userId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getActiveMembers(_teamId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async getMembersWithProfiles(_teamId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async rename(_teamId, _name) {
      void supabase;
      throw new Error("Not implemented");
    },
    async softDelete(_teamId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async removeMember(_teamId, _userId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async changeMemberRole(_teamId, _userId, _role) {
      void supabase;
      throw new Error("Not implemented");
    },
    async transferOwnership(_teamId, _newOwnerId) {
      void supabase;
      throw new Error("Not implemented");
    },
    async findOtherAdmins(_teamId, _excludeUserId) {
      void supabase;
      throw new Error("Not implemented");
    },
  };
}
