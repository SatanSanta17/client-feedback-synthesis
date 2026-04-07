import { type SupabaseClient } from "@supabase/supabase-js";

import type {
  InvitationRepository,
  InvitationRow,
  InvitationWithTeamRow,
} from "../invitation-repository";

/**
 * Factory for creating a Supabase-backed InvitationRepository.
 *
 * @param supabase      - Anon client (RLS-scoped, for user-facing queries)
 * @param serviceClient - Service-role client (bypasses RLS, for token lookups and acceptance)
 */
export function createInvitationRepository(
  supabase: SupabaseClient,
  serviceClient: SupabaseClient
): InvitationRepository {
  return {
    async create(invitation): Promise<void> {
      console.log("[supabase-invitation-repo] create — email:", invitation.email, "teamId:", invitation.team_id);

      const { error } = await supabase
        .from("team_invitations")
        .insert({
          team_id: invitation.team_id,
          email: invitation.email,
          role: invitation.role,
          invited_by: invitation.invited_by,
          token: invitation.token,
          expires_at: invitation.expires_at,
        });

      if (error) {
        console.error("[supabase-invitation-repo] create error:", error.message);
        throw error;
      }
    },

    async getAllForTeam(
      teamId: string
    ): Promise<Array<{ email: string; expires_at: string; accepted_at: string | null }>> {
      const { data, error } = await supabase
        .from("team_invitations")
        .select("email, expires_at, accepted_at")
        .eq("team_id", teamId);

      if (error) {
        console.error("[supabase-invitation-repo] getAllForTeam error:", error.message);
        return [];
      }

      return data ?? [];
    },

    async getPending(teamId: string): Promise<InvitationRow[]> {
      const { data, error } = await supabase
        .from("team_invitations")
        .select("*")
        .eq("team_id", teamId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[supabase-invitation-repo] getPending error:", error.message);
        return [];
      }

      return data ?? [];
    },

    async revoke(teamId: string, invitationId: string): Promise<void> {
      console.log("[supabase-invitation-repo] revoke — id:", invitationId);

      const { error } = await supabase
        .from("team_invitations")
        .delete()
        .eq("id", invitationId)
        .eq("team_id", teamId);

      if (error) {
        console.error("[supabase-invitation-repo] revoke error:", error.message);
        throw new Error("Failed to revoke invitation");
      }

      console.log("[supabase-invitation-repo] revoke — success:", invitationId);
    },

    async refreshToken(
      teamId: string,
      invitationId: string,
      newToken: string,
      newExpiresAt: string
    ): Promise<{ email: string; role: "admin" | "sales" } | null> {
      console.log("[supabase-invitation-repo] refreshToken — id:", invitationId);

      const { data, error } = await supabase
        .from("team_invitations")
        .update({ token: newToken, expires_at: newExpiresAt })
        .eq("id", invitationId)
        .eq("team_id", teamId)
        .is("accepted_at", null)
        .select("email, role")
        .single();

      if (error || !data) {
        console.error("[supabase-invitation-repo] refreshToken error:", error?.message);
        return null;
      }

      return data;
    },

    async getByToken(token: string): Promise<InvitationWithTeamRow | null> {
      console.log("[supabase-invitation-repo] getByToken");

      const { data, error } = await serviceClient
        .from("team_invitations")
        .select("*, teams:team_id ( name )")
        .eq("token", token)
        .single();

      if (error || !data) {
        console.error("[supabase-invitation-repo] getByToken — not found:", error?.message);
        return null;
      }

      const teamName =
        (data.teams as unknown as { name: string } | null)?.name ?? "Unknown Team";

      return {
        id: data.id,
        team_id: data.team_id,
        email: data.email,
        role: data.role,
        invited_by: data.invited_by,
        token: data.token,
        expires_at: data.expires_at,
        accepted_at: data.accepted_at,
        created_at: data.created_at,
        team_name: teamName,
      };
    },

    async isUserTeamMember(teamId: string, userId: string): Promise<boolean> {
      const { data } = await serviceClient
        .from("team_members")
        .select("id")
        .eq("team_id", teamId)
        .eq("user_id", userId)
        .is("removed_at", null)
        .maybeSingle();

      return !!data;
    },

    async addTeamMember(teamId: string, userId: string, role: string): Promise<void> {
      console.log("[supabase-invitation-repo] addTeamMember — teamId:", teamId, "userId:", userId, "role:", role);

      const { error } = await serviceClient
        .from("team_members")
        .insert({ team_id: teamId, user_id: userId, role });

      if (error) {
        console.error("[supabase-invitation-repo] addTeamMember error:", error.message);
        throw new Error("Failed to add user to team");
      }

      console.log("[supabase-invitation-repo] addTeamMember — success");
    },

    async markAccepted(invitationId: string): Promise<void> {
      console.log("[supabase-invitation-repo] markAccepted — id:", invitationId);

      const { error } = await serviceClient
        .from("team_invitations")
        .update({ accepted_at: new Date().toISOString() })
        .eq("id", invitationId);

      if (error) {
        console.error("[supabase-invitation-repo] markAccepted error:", error.message);
        throw new Error("Failed to mark invitation as accepted");
      }

      console.log("[supabase-invitation-repo] markAccepted — success:", invitationId);
    },
  };
}
