import crypto from "crypto";
import type {
  InvitationRepository,
  InvitationRow,
  InvitationWithTeamRow,
} from "@/lib/repositories/invitation-repository";
import type { TeamRepository } from "@/lib/repositories/team-repository";
import { sendEmail } from "@/lib/services/email-service";
import { buildInviteEmailHtml } from "@/lib/email-templates/invite-email";

// ---------------------------------------------------------------------------
// Re-export types for backward compatibility
// ---------------------------------------------------------------------------

export type TeamInvitation = InvitationRow;
export type InvitationWithTeam = InvitationWithTeamRow;

export type InvitationStatus = "valid" | "expired" | "already_accepted" | "invalid";

export interface InviteResult {
  sent: string[];
  skipped: Array<{ email: string; reason: string }>;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const INVITE_EXPIRY_DAYS = 7;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createInvitations(
  invitationRepo: InvitationRepository,
  teamRepo: TeamRepository,
  teamId: string,
  emails: string[],
  role: "admin" | "sales",
  invitedBy: string,
  inviterEmail: string,
  teamName: string
): Promise<InviteResult> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const result: InviteResult = { sent: [], skipped: [] };

  // Get current members to check for duplicates
  const members = await teamRepo.getActiveMembers(teamId);
  const membersWithProfiles = await teamRepo.getMembersWithProfiles(teamId);
  const memberEmailSet = new Set(
    membersWithProfiles.map((m) => m.email.toLowerCase())
  );

  // Get existing invitations to check for pending duplicates
  const existingInvites = await invitationRepo.getAllForTeam(teamId);
  const pendingInviteEmails = new Set(
    existingInvites
      .filter(
        (inv) =>
          !inv.accepted_at && new Date(inv.expires_at) > new Date()
      )
      .map((inv) => inv.email.toLowerCase())
  );

  // Suppress unused variable — members is used for the count check upstream
  void members;

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  for (const rawEmail of emails) {
    const email = rawEmail.trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      result.skipped.push({ email: rawEmail, reason: "Invalid email" });
      continue;
    }

    if (memberEmailSet.has(email)) {
      result.skipped.push({ email, reason: "Already a team member" });
      continue;
    }

    if (pendingInviteEmails.has(email)) {
      result.skipped.push({ email, reason: "Invitation already pending" });
      continue;
    }

    const token = generateToken();

    try {
      await invitationRepo.create({
        team_id: teamId,
        email,
        role,
        invited_by: invitedBy,
        token,
        expires_at: expiresAt.toISOString(),
      });
    } catch {
      result.skipped.push({ email, reason: "Failed to create invitation" });
      continue;
    }

    const inviteUrl = `${appUrl}/invite/${token}`;

    try {
      await sendEmail({
        to: email,
        subject: `You're invited to join ${teamName} on Synthesiser`,
        html: buildInviteEmailHtml({
          teamName,
          inviterEmail,
          role,
          inviteUrl,
        }),
      });
      result.sent.push(email);
      pendingInviteEmails.add(email);
    } catch (emailErr) {
      console.error(
        `[invitation-service] createInvitations — email send failed for ${email}:`,
        emailErr instanceof Error ? emailErr.message : emailErr
      );
      result.skipped.push({ email, reason: "Failed to send email" });
    }
  }

  console.log(
    `[invitation-service] createInvitations — sent: ${result.sent.length}, skipped: ${result.skipped.length}`
  );

  return result;
}

export async function getPendingInvitations(
  repo: InvitationRepository,
  teamId: string
): Promise<InvitationRow[]> {
  return repo.getPending(teamId);
}

export async function revokeInvitation(
  repo: InvitationRepository,
  teamId: string,
  invitationId: string
): Promise<void> {
  await repo.revoke(teamId, invitationId);

  console.log(`[invitation-service] revokeInvitation — revoked ${invitationId}`);
}

export async function resendInvitation(
  repo: InvitationRepository,
  teamId: string,
  invitationId: string,
  inviterEmail: string,
  teamName: string
): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const newToken = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  const data = await repo.refreshToken(
    teamId,
    invitationId,
    newToken,
    expiresAt.toISOString()
  );

  if (!data) {
    throw new Error("Failed to resend invitation");
  }

  const inviteUrl = `${appUrl}/invite/${newToken}`;

  await sendEmail({
    to: data.email,
    subject: `You're invited to join ${teamName} on Synthesiser`,
    html: buildInviteEmailHtml({
      teamName,
      inviterEmail,
      role: data.role,
      inviteUrl,
    }),
  });

  console.log(`[invitation-service] resendInvitation — resent ${invitationId} to ${data.email}`);
}

// ---------------------------------------------------------------------------
// Token-based lookup & acceptance
// ---------------------------------------------------------------------------

export async function getInvitationByToken(
  repo: InvitationRepository,
  token: string
): Promise<{ invitation: InvitationWithTeamRow; status: InvitationStatus } | null> {
  const invitation = await repo.getByToken(token);

  if (!invitation) {
    return null;
  }

  if (invitation.accepted_at) {
    return { invitation, status: "already_accepted" };
  }

  if (new Date(invitation.expires_at) < new Date()) {
    return { invitation, status: "expired" };
  }

  return { invitation, status: "valid" };
}

export async function acceptInvitation(
  repo: InvitationRepository,
  invitationId: string,
  userId: string,
  teamId: string,
  role: string
): Promise<void> {
  const isExistingMember = await repo.isUserTeamMember(teamId, userId);

  if (!isExistingMember) {
    await repo.addTeamMember(teamId, userId, role);
    console.log(`[invitation-service] acceptInvitation — added user ${userId} to team ${teamId} as ${role}`);
  } else {
    console.log(`[invitation-service] acceptInvitation — user ${userId} already a member of team ${teamId}, skipping insert`);
  }

  await repo.markAccepted(invitationId);

  console.log(`[invitation-service] acceptInvitation — invitation ${invitationId} marked as accepted`);
}
