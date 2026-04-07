// ---------------------------------------------------------------------------
// Team Repository Interface
// ---------------------------------------------------------------------------

export interface TeamRow {
  id: string;
  name: string;
  owner_id: string;
  created_by: string;
  created_at: string;
  deleted_at: string | null;
}

export interface TeamMemberRow {
  id: string;
  team_id: string;
  user_id: string;
  role: "admin" | "sales";
  joined_at: string;
  removed_at: string | null;
}

export interface TeamMemberWithProfileRow {
  user_id: string;
  role: string;
  joined_at: string;
  email: string;
}

export interface TeamWithRoleRow {
  id: string;
  name: string;
  role: string;
}

export interface TeamRepository {
  /** Create a team and add the creator as admin member. */
  create(name: string, userId: string): Promise<TeamRow>;

  /** Get a team by ID (non-deleted only). */
  getById(teamId: string): Promise<TeamRow | null>;

  /** Get all non-deleted teams the current user belongs to. */
  getForUser(): Promise<TeamRow[]>;

  /** Get teams with the user's role for each. */
  getWithRolesForUser(userId: string): Promise<TeamWithRoleRow[]>;

  /** Get a single team member by team + user (non-removed only). */
  getMember(teamId: string, userId: string): Promise<TeamMemberRow | null>;

  /** Get all active (non-removed) members of a team. */
  getActiveMembers(teamId: string): Promise<TeamMemberRow[]>;

  /** Get members with profile emails (service-role query). */
  getMembersWithProfiles(teamId: string): Promise<TeamMemberWithProfileRow[]>;

  /** Rename a team. Returns the updated team. */
  rename(teamId: string, name: string): Promise<TeamRow>;

  /** Soft-delete a team. */
  softDelete(teamId: string): Promise<void>;

  /** Soft-remove a member from a team. */
  removeMember(teamId: string, userId: string): Promise<void>;

  /** Change a member's role. */
  changeMemberRole(teamId: string, userId: string, role: "admin" | "sales"): Promise<void>;

  /** Transfer team ownership to another user (promotes to admin if needed). */
  transferOwnership(teamId: string, newOwnerId: string): Promise<void>;

  /** Find other admins in a team (excluding a given user). Used for leave/transfer logic. */
  findOtherAdmins(teamId: string, excludeUserId: string): Promise<Array<{ user_id: string; joined_at: string }>>;
}
