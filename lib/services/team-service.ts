import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: "admin" | "sales";
  joined_at: string;
  removed_at: string | null;
}

// ---------------------------------------------------------------------------
// Team CRUD
// ---------------------------------------------------------------------------

export async function createTeam(
  name: string,
  userId: string
): Promise<Team> {
  const supabase = await createClient();

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .insert({ name: name.trim(), owner_id: userId })
    .select()
    .single();

  if (teamError) {
    console.error("[team-service] createTeam error:", teamError.message);
    throw new Error("Failed to create team");
  }

  const { error: memberError } = await supabase
    .from("team_members")
    .insert({ team_id: team.id, user_id: userId, role: "admin" });

  if (memberError) {
    console.error("[team-service] createTeam — failed to add owner as member:", memberError.message);
    throw new Error("Failed to add owner as team member");
  }

  console.log(`[team-service] createTeam — created team ${team.id} with owner ${userId}`);
  return team;
}

export async function getTeamsForUser(): Promise<Team[]> {
  const supabase = await createClient();

  const { data: memberships, error: memberError } = await supabase
    .from("team_members")
    .select("team_id")
    .is("removed_at", null);

  if (memberError) {
    console.error("[team-service] getTeamsForUser error:", memberError.message);
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
    console.error("[team-service] getTeamsForUser error:", teamError.message);
    return [];
  }

  return teams ?? [];
}

export async function getTeamById(teamId: string): Promise<Team | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .is("deleted_at", null)
    .single();

  if (error) {
    console.error("[team-service] getTeamById error:", error.message);
    return null;
  }

  return data;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function getTeamMember(
  teamId: string,
  userId: string
): Promise<TeamMember | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) {
    console.error("[team-service] getTeamMember error:", error.message);
    return null;
  }

  return data;
}

export async function getActiveTeamMembers(
  teamId: string
): Promise<TeamMember[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .is("removed_at", null)
    .order("joined_at", { ascending: true });

  if (error) {
    console.error("[team-service] getActiveTeamMembers error:", error.message);
    return [];
  }

  return data ?? [];
}
