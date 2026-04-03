import crypto from "crypto";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/services/email-service";

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

export interface TeamInvitation {
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

export interface InviteResult {
  sent: string[];
  skipped: Array<{ email: string; reason: string }>;
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

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

const INVITE_EXPIRY_DAYS = 7;

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function buildInviteEmailHtml(params: {
  teamName: string;
  inviterEmail: string;
  role: string;
  inviteUrl: string;
}): string {
  const { teamName, inviterEmail, role, inviteUrl } = params;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
      <h2 style="font-size: 20px; font-weight: 600; margin: 0 0 16px;">You're invited to join ${teamName}</h2>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
        ${inviterEmail} invited you to join <strong>${teamName}</strong> on Synthesiser.
      </p>
      <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 24px;">
        You've been invited as <strong>${role}</strong>.
      </p>
      <a href="${inviteUrl}" style="display: inline-block; background: #4f46e5; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-size: 15px; font-weight: 500;">
        Join Team
      </a>
      <p style="color: #999; font-size: 13px; margin-top: 24px;">
        This invitation expires in ${INVITE_EXPIRY_DAYS} days.
      </p>
    </div>
  `;
}

export async function createInvitations(
  teamId: string,
  emails: string[],
  role: "admin" | "sales",
  invitedBy: string,
  inviterEmail: string,
  teamName: string
): Promise<InviteResult> {
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const result: InviteResult = { sent: [], skipped: [] };

  const members = await getActiveTeamMembers(teamId);

  // Fetch member emails via profiles for dedup
  const serviceClient = createServiceRoleClient();
  const memberUserIds = members.map((m) => m.user_id);
  const { data: profiles } = await serviceClient
    .from("profiles")
    .select("id, email")
    .in("id", memberUserIds);
  const memberEmailSet = new Set(
    (profiles ?? []).map((p) => p.email.toLowerCase())
  );

  // Fetch existing pending invitations for this team
  const { data: existingInvites } = await supabase
    .from("team_invitations")
    .select("email, expires_at, accepted_at")
    .eq("team_id", teamId);

  const pendingInviteEmails = new Set(
    (existingInvites ?? [])
      .filter(
        (inv) =>
          !inv.accepted_at && new Date(inv.expires_at) > new Date()
      )
      .map((inv) => inv.email.toLowerCase())
  );

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

    const { error: insertError } = await supabase
      .from("team_invitations")
      .insert({
        team_id: teamId,
        email,
        role,
        invited_by: invitedBy,
        token,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error(`[team-service] createInvitations — insert failed for ${email}:`, insertError.message);
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
      console.error(`[team-service] createInvitations — email send failed for ${email}:`,
        emailErr instanceof Error ? emailErr.message : emailErr
      );
      result.skipped.push({ email, reason: "Failed to send email" });
    }
  }

  console.log(
    `[team-service] createInvitations — sent: ${result.sent.length}, skipped: ${result.skipped.length}`
  );

  return result;
}

export async function getPendingInvitations(
  teamId: string
): Promise<TeamInvitation[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("team_invitations")
    .select("*")
    .eq("team_id", teamId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[team-service] getPendingInvitations error:", error.message);
    return [];
  }

  return data ?? [];
}

export async function revokeInvitation(
  teamId: string,
  invitationId: string
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("team_invitations")
    .delete()
    .eq("id", invitationId)
    .eq("team_id", teamId);

  if (error) {
    console.error("[team-service] revokeInvitation error:", error.message);
    throw new Error("Failed to revoke invitation");
  }

  console.log(`[team-service] revokeInvitation — revoked ${invitationId}`);
}

export async function resendInvitation(
  teamId: string,
  invitationId: string,
  inviterEmail: string,
  teamName: string
): Promise<void> {
  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const newToken = generateToken();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

  const { data, error } = await supabase
    .from("team_invitations")
    .update({ token: newToken, expires_at: expiresAt.toISOString() })
    .eq("id", invitationId)
    .eq("team_id", teamId)
    .is("accepted_at", null)
    .select("email, role")
    .single();

  if (error || !data) {
    console.error("[team-service] resendInvitation error:", error?.message);
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

  console.log(`[team-service] resendInvitation — resent ${invitationId} to ${data.email}`);
}
