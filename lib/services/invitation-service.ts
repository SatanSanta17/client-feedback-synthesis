import crypto from "crypto";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/services/email-service";
import { getActiveTeamMembers } from "@/lib/services/team-service";
import { buildInviteEmailHtml } from "@/lib/email-templates/invite-email";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  const serviceClient = createServiceRoleClient();
  const memberUserIds = members.map((m) => m.user_id);
  const { data: profiles } = await serviceClient
    .from("profiles")
    .select("id, email")
    .in("id", memberUserIds);
  const memberEmailSet = new Set(
    (profiles ?? []).map((p) => p.email.toLowerCase())
  );

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
      console.error(`[invitation-service] createInvitations — insert failed for ${email}:`, insertError.message);
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
      console.error(`[invitation-service] createInvitations — email send failed for ${email}:`,
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
    console.error("[invitation-service] getPendingInvitations error:", error.message);
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
    console.error("[invitation-service] revokeInvitation error:", error.message);
    throw new Error("Failed to revoke invitation");
  }

  console.log(`[invitation-service] revokeInvitation — revoked ${invitationId}`);
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
    console.error("[invitation-service] resendInvitation error:", error?.message);
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
