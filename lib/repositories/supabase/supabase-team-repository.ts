import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  TeamRepository,
  TeamRow,
  TeamMemberRow,
  TeamMemberWithProfileRow,
  TeamWithRoleRow,
} from "../team-repository";

/**
 * Factory for creating a Supabase-backed TeamRepository.
 *
 * @param supabase  - Anon client (respects RLS, used for user-facing queries)
 * @param serviceClient - Service-role client (bypasses RLS, used for cross-user queries)
 */
export function createTeamRepository(
  supabase: SupabaseClient,
  serviceClient: SupabaseClient
): TeamRepository {
  return {
    async create(name: string, userId: string): Promise<TeamRow> {
      console.log("[supabase-team-repo] create — name:", name, "userId:", userId);

      const { data: team, error: teamError } = await supabase
        .from("teams")
        .insert({ name: name.trim(), owner_id: userId })
        .select()
        .single();

      if (teamError) {
        console.error("[supabase-team-repo] create — team insert error:", teamError.message);
        throw new Error("Failed to create team");
      }

      const { error: memberError } = await supabase
        .from("team_members")
        .insert({ team_id: team.id, user_id: userId, role: "admin" });

      if (memberError) {
        console.error("[supabase-team-repo] create — member insert error:", memberError.message);
        throw new Error("Failed to add owner as team member");
      }

      console.log(`[supabase-team-repo] create — success: ${team.id}`);
      return team;
    },

    async getById(teamId: string): Promise<TeamRow | null> {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("id", teamId)
        .is("deleted_at", null)
        .single();

      if (error) {
        console.error("[supabase-team-repo] getById error:", error.message);
        return null;
      }

      return data;
    },

    async getForUser(): Promise<TeamRow[]> {
      const { data: memberships, error: memberError } = await supabase
        .from("team_members")
        .select("team_id")
        .is("removed_at", null);

      if (memberError) {
        console.error("[supabase-team-repo] getForUser — membership error:", memberError.message);
        return [];
      }

      if (!memberships || memberships.length === 0) return [];

      const teamIds = memberships.map((m) => m.team_id);

      const { data: teams, error: teamError } = await supabase
        .from("teams")
        .select("*")
        .in("id", teamIds)
        .is("deleted_at", null)
        .order("created_at", { ascending: true });

      if (teamError) {
        console.error("[supabase-team-repo] getForUser — teams error:", teamError.message);
        return [];
      }

      return teams ?? [];
    },

    async getWithRolesForUser(userId: string): Promise<TeamWithRoleRow[]> {
      console.log("[supabase-team-repo] getWithRolesForUser — userId:", userId);

      // Get teams via getForUser (uses anon client with RLS)
      const teams = await this.getForUser();

      const { data: memberships } = await supabase
        .from("team_members")
        .select("team_id, role")
        .eq("user_id", userId)
        .is("removed_at", null);

      const roleByTeamId = new Map(
        (memberships ?? []).map((m) => [m.team_id, m.role])
      );

      const result = teams.map((t) => ({
        id: t.id,
        name: t.name,
        role: roleByTeamId.get(t.id) ?? "sales",
      }));

      console.log("[supabase-team-repo] getWithRolesForUser —", result.length, "teams");
      return result;
    },

    async getMember(teamId: string, userId: string): Promise<TeamMemberRow | null> {
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .is("removed_at", null)
        .maybeSingle();

      if (error) {
        console.error("[supabase-team-repo] getMember error:", error.message);
        return null;
      }

      return data;
    },

    async getActiveMembers(teamId: string): Promise<TeamMemberRow[]> {
      const { data, error } = await supabase
        .from("team_members")
        .select("*")
        .eq("team_id", teamId)
        .is("removed_at", null)
        .order("joined_at", { ascending: true });

      if (error) {
        console.error("[supabase-team-repo] getActiveMembers error:", error.message);
        return [];
      }

      return data ?? [];
    },

    async getMembersWithProfiles(teamId: string): Promise<TeamMemberWithProfileRow[]> {
      console.log("[supabase-team-repo] getMembersWithProfiles — teamId:", teamId);

      const { data: members, error } = await serviceClient
        .from("team_members")
        .select("user_id, role, joined_at")
        .eq("team_id", teamId)
        .is("removed_at", null)
        .order("joined_at", { ascending: true });

      if (error) {
        console.error("[supabase-team-repo] getMembersWithProfiles error:", error.message);
        throw new Error("Failed to fetch team members");
      }

      const userIds = (members ?? []).map((m) => m.user_id);

      const { data: profiles } = await serviceClient
        .from("profiles")
        .select("id, email")
        .in("id", userIds);

      const emailByUserId = new Map(
        (profiles ?? []).map((p) => [p.id, p.email])
      );

      const result = (members ?? []).map((m) => ({
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        email: emailByUserId.get(m.user_id) ?? "unknown",
      }));

      console.log("[supabase-team-repo] getMembersWithProfiles —", result.length, "members");
      return result;
    },

    async rename(teamId: string, name: string): Promise<TeamRow> {
      console.log("[supabase-team-repo] rename — teamId:", teamId, "name:", name);

      const { data, error } = await supabase
        .from("teams")
        .update({ name: name.trim() })
        .eq("id", teamId)
        .is("deleted_at", null)
        .select()
        .single();

      if (error) {
        console.error("[supabase-team-repo] rename error:", error.message);
        throw new Error("Failed to rename team");
      }

      console.log("[supabase-team-repo] rename — success:", data.id);
      return data;
    },

    async softDelete(teamId: string): Promise<void> {
      console.log("[supabase-team-repo] softDelete — teamId:", teamId);

      const { error } = await serviceClient
        .from("teams")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", teamId)
        .is("deleted_at", null);

      if (error) {
        console.error("[supabase-team-repo] softDelete error:", error.message);
        throw new Error("Failed to delete team");
      }

      console.log("[supabase-team-repo] softDelete — success:", teamId);
    },

    async removeMember(teamId: string, userId: string): Promise<void> {
      console.log("[supabase-team-repo] removeMember — teamId:", teamId, "userId:", userId);

      const { data, error } = await serviceClient
        .from("team_members")
        .update({ removed_at: new Date().toISOString() })
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .is("removed_at", null)
        .select("id")
        .single();

      if (error) {
        console.error("[supabase-team-repo] removeMember error:", error.message);
        throw new Error("Failed to remove member");
      }

      console.log("[supabase-team-repo] removeMember — removed membership:", data.id);
    },

    async changeMemberRole(teamId: string, userId: string, role: "admin" | "sales"): Promise<void> {
      console.log("[supabase-team-repo] changeMemberRole — teamId:", teamId, "userId:", userId, "role:", role);

      const { error } = await supabase
        .from("team_members")
        .update({ role })
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .is("removed_at", null);

      if (error) {
        console.error("[supabase-team-repo] changeMemberRole error:", error.message);
        throw new Error("Failed to change member role");
      }

      console.log("[supabase-team-repo] changeMemberRole — success");
    },

    async transferOwnership(teamId: string, newOwnerId: string): Promise<void> {
      console.log("[supabase-team-repo] transferOwnership — teamId:", teamId, "newOwnerId:", newOwnerId);

      // Promote the new owner to admin if they are currently sales
      const { data: member } = await serviceClient
        .from("team_members")
        .select("role")
        .eq("team_id", teamId)
        .eq("user_id", newOwnerId)
        .is("removed_at", null)
        .single();

      if (member?.role === "sales") {
        const { error: promoteError } = await serviceClient
          .from("team_members")
          .update({ role: "admin" })
          .eq("team_id", teamId)
          .eq("user_id", newOwnerId)
          .is("removed_at", null);

        if (promoteError) {
          console.error("[supabase-team-repo] transferOwnership — promote error:", promoteError.message);
          throw new Error("Failed to promote new owner to admin");
        }
      }

      const { error } = await serviceClient
        .from("teams")
        .update({ owner_id: newOwnerId })
        .eq("id", teamId)
        .is("deleted_at", null);

      if (error) {
        console.error("[supabase-team-repo] transferOwnership error:", error.message);
        throw new Error("Failed to transfer ownership");
      }

      console.log("[supabase-team-repo] transferOwnership — success: new owner", newOwnerId);
    },

    async findOtherAdmins(
      teamId: string,
      excludeUserId: string
    ): Promise<Array<{ user_id: string; joined_at: string }>> {
      console.log("[supabase-team-repo] findOtherAdmins — teamId:", teamId, "excluding:", excludeUserId);

      const { data, error } = await serviceClient
        .from("team_members")
        .select("user_id, joined_at")
        .eq("team_id", teamId)
        .eq("role", "admin")
        .is("removed_at", null)
        .neq("user_id", excludeUserId)
        .order("joined_at", { ascending: true });

      if (error) {
        console.error("[supabase-team-repo] findOtherAdmins error:", error.message);
        return [];
      }

      return data ?? [];
    },
  };
}
