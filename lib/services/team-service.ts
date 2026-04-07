import type {
  TeamRepository,
  TeamRow,
  TeamMemberRow,
  TeamMemberWithProfileRow,
  TeamWithRoleRow,
} from "@/lib/repositories/team-repository";

// Re-export types for backward compatibility with existing consumers
export type Team = TeamRow;
export type TeamMember = TeamMemberRow;
export type TeamMemberWithProfile = TeamMemberWithProfileRow;
export type TeamWithRole = TeamWithRoleRow;

// ---------------------------------------------------------------------------
// Team CRUD
// ---------------------------------------------------------------------------

export async function createTeam(
  repo: TeamRepository,
  name: string,
  userId: string
): Promise<TeamRow> {
  console.log(`[team-service] createTeam — name: ${name}, userId: ${userId}`);

  const team = await repo.create(name, userId);

  console.log(`[team-service] createTeam — created team ${team.id} with owner ${userId}`);
  return team;
}

export async function getTeamsForUser(
  repo: TeamRepository
): Promise<TeamRow[]> {
  return repo.getForUser();
}

export async function getTeamById(
  repo: TeamRepository,
  teamId: string
): Promise<TeamRow | null> {
  return repo.getById(teamId);
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export async function getTeamMember(
  repo: TeamRepository,
  teamId: string,
  userId: string
): Promise<TeamMemberRow | null> {
  return repo.getMember(teamId, userId);
}

export async function getActiveTeamMembers(
  repo: TeamRepository,
  teamId: string
): Promise<TeamMemberRow[]> {
  return repo.getActiveMembers(teamId);
}

// ---------------------------------------------------------------------------
// Data Assembly
// ---------------------------------------------------------------------------

export async function getTeamMembersWithProfiles(
  repo: TeamRepository,
  teamId: string
): Promise<TeamMemberWithProfileRow[]> {
  console.log("[team-service] getTeamMembersWithProfiles — teamId:", teamId);

  const result = await repo.getMembersWithProfiles(teamId);

  console.log("[team-service] getTeamMembersWithProfiles —", result.length, "members");
  return result;
}

export async function getTeamsWithRolesForUser(
  repo: TeamRepository,
  userId: string
): Promise<TeamWithRoleRow[]> {
  console.log("[team-service] getTeamsWithRolesForUser — userId:", userId);

  const result = await repo.getWithRolesForUser(userId);

  console.log("[team-service] getTeamsWithRolesForUser —", result.length, "teams");
  return result;
}

// ---------------------------------------------------------------------------
// Team Management
// ---------------------------------------------------------------------------

export async function renameTeam(
  repo: TeamRepository,
  teamId: string,
  name: string
): Promise<TeamRow> {
  console.log(`[team-service] renameTeam — teamId: ${teamId}, name: ${name}`);

  const updated = await repo.rename(teamId, name);

  console.log(`[team-service] renameTeam — success: ${updated.id}`);
  return updated;
}

export async function deleteTeam(
  repo: TeamRepository,
  teamId: string
): Promise<void> {
  console.log(`[team-service] deleteTeam — teamId: ${teamId}`);

  await repo.softDelete(teamId);

  console.log(`[team-service] deleteTeam — success: ${teamId}`);
}

export async function removeMember(
  repo: TeamRepository,
  teamId: string,
  userId: string
): Promise<void> {
  console.log(`[team-service] removeMember — teamId: ${teamId}, userId: ${userId}`);

  await repo.removeMember(teamId, userId);

  console.log(`[team-service] removeMember — success`);
}

export async function changeMemberRole(
  repo: TeamRepository,
  teamId: string,
  userId: string,
  role: "admin" | "sales"
): Promise<void> {
  console.log(`[team-service] changeMemberRole — teamId: ${teamId}, userId: ${userId}, role: ${role}`);

  await repo.changeMemberRole(teamId, userId, role);

  console.log(`[team-service] changeMemberRole — success`);
}

export async function transferOwnership(
  repo: TeamRepository,
  teamId: string,
  newOwnerId: string
): Promise<void> {
  console.log(`[team-service] transferOwnership — teamId: ${teamId}, newOwnerId: ${newOwnerId}`);

  await repo.transferOwnership(teamId, newOwnerId);

  console.log(`[team-service] transferOwnership — success: new owner ${newOwnerId}`);
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export class LeaveBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeaveBlockedError";
  }
}

export async function leaveTeam(
  repo: TeamRepository,
  teamId: string,
  userId: string,
  isOwner: boolean
): Promise<{ autoTransferredTo?: string }> {
  console.log(`[team-service] leaveTeam — teamId: ${teamId}, userId: ${userId}, isOwner: ${isOwner}`);

  let autoTransferredTo: string | undefined;

  if (isOwner) {
    const admins = await repo.findOtherAdmins(teamId, userId);

    if (admins.length === 0) {
      throw new LeaveBlockedError(
        "You must promote another member to admin before leaving, or delete the team."
      );
    }

    const newOwner = admins[0];
    await repo.transferOwnership(teamId, newOwner.user_id);
    autoTransferredTo = newOwner.user_id;

    console.log(`[team-service] leaveTeam — auto-transferred ownership to ${newOwner.user_id}`);
  }

  await repo.removeMember(teamId, userId);

  console.log(`[team-service] leaveTeam — user ${userId} left team ${teamId}`);
  return { autoTransferredTo };
}
