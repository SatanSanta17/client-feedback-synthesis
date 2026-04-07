// ---------------------------------------------------------------------------
// Invitation Repository Interface
// ---------------------------------------------------------------------------

export interface InvitationRow {
  id: string;
  team_id: string;
  email: string;
  role: "admin" | "sales";
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface InvitationWithTeamRow extends InvitationRow {
  team_name: string;
}

export interface InvitationRepository {
  /** Insert a new invitation row. */
  create(invitation: {
    team_id: string;
    email: string;
    role: "admin" | "sales";
    invited_by: string;
    token: string;
    expires_at: string;
  }): Promise<void>;

  /** Fetch all invitations for a team (pending and accepted). Used for duplicate checking. */
  getAllForTeam(teamId: string): Promise<Array<{ email: string; expires_at: string; accepted_at: string | null }>>;

  /** Fetch pending (non-accepted) invitations for a team, newest first. */
  getPending(teamId: string): Promise<InvitationRow[]>;

  /** Hard-delete an invitation by ID + team ID. */
  revoke(teamId: string, invitationId: string): Promise<void>;

  /** Update an invitation's token and expiry (for resend). Returns the email and role. */
  refreshToken(
    teamId: string,
    invitationId: string,
    newToken: string,
    newExpiresAt: string
  ): Promise<{ email: string; role: "admin" | "sales" } | null>;

  /** Fetch an invitation by token, joined with team name (service-role). */
  getByToken(token: string): Promise<InvitationWithTeamRow | null>;

  /** Check if a user is already a member of a team (service-role). */
  isUserTeamMember(teamId: string, userId: string): Promise<boolean>;

  /** Add a user to a team as a member (service-role). */
  addTeamMember(teamId: string, userId: string, role: string): Promise<void>;

  /** Mark an invitation as accepted (service-role). */
  markAccepted(invitationId: string): Promise<void>;
}
