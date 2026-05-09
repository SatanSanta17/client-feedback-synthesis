import { redirect } from "next/navigation";
import { getInvitationByToken } from "@/lib/services/invitation-service";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import { parseInviteToken } from "@/lib/invite/token";
import { appendInviteParam } from "@/lib/invite/url";
import { InviteStatusCard } from "./_components/invite-status-card";
import { InviteMismatchCard } from "./_components/invite-mismatch-card";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token: rawToken } = await params;
  const token = parseInviteToken(rawToken);

  if (!token) {
    console.log("[invite-dispatch] invalid token shape");
    return <InviteStatusCard status="invalid" teamName={null} />;
  }

  const tokenShort = token.slice(0, 8);
  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const invitationRepo = createInvitationRepository(supabase, serviceClient);

  const result = await getInvitationByToken(invitationRepo, token);

  if (!result) {
    console.log(`[invite-dispatch] invalid token=${tokenShort}`);
    return <InviteStatusCard status="invalid" teamName={null} />;
  }

  const { invitation, status } = result;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const emailsMatch =
      user.email?.toLowerCase() === invitation.email.toLowerCase();

    if (!emailsMatch) {
      console.log(
        `[invite-dispatch] mismatch token=${tokenShort} invited=${invitation.email} user=${user.email}`
      );
      return (
        <InviteMismatchCard
          teamName={invitation.team_name}
          role={invitation.role}
          invitedEmail={invitation.email}
          userEmail={user.email ?? "(unknown email)"}
          inviteToken={token}
        />
      );
    }

    // Already a member of the invited team — re-clicking the link should take
    // the user back to the team workspace, regardless of invitation status
    // (could be `already_accepted`, could be `valid` after a re-invite).
    const isMember = await invitationRepo.isUserTeamMember(
      invitation.team_id,
      user.id
    );

    if (isMember) {
      console.log(
        `[invite-dispatch] already-member token=${tokenShort} user=${user.email} → /api/invite/${tokenShort}/accept`
      );
      redirect(`/api/invite/${token}/accept`);
    }

    // Authed + match + not a member: only proceed if the invitation is still
    // valid. Expired or already-accepted (by someone else with this email
    // somehow — not normally reachable) → status card.
    if (status !== "valid") {
      console.log(`[invite-dispatch] ${status} token=${tokenShort} (authed non-member)`);
      return (
        <InviteStatusCard status={status} teamName={invitation.team_name} />
      );
    }

    console.log(
      `[invite-dispatch] match token=${tokenShort} user=${user.email} → /api/invite/${tokenShort}/accept`
    );
    redirect(`/api/invite/${token}/accept`);
  }

  // Unauthenticated branch — only valid invitations route through to login or
  // signup. Expired / already-accepted tokens render the status card so the
  // user knows why they can't proceed.
  if (status !== "valid") {
    console.log(`[invite-dispatch] ${status} token=${tokenShort} (anonymous)`);
    return (
      <InviteStatusCard status={status} teamName={invitation.team_name} />
    );
  }

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("id")
    .eq("email", invitation.email.toLowerCase())
    .maybeSingle();

  const target = profile ? "/login" : "/signup";
  console.log(
    `[invite-dispatch] anonymous token=${tokenShort} → ${target} (profile=${!!profile})`
  );
  redirect(appendInviteParam(target, token));
}
