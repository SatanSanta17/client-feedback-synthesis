import { redirect } from "next/navigation";
import {
  acceptAndActivate,
  getInvitationByToken,
} from "@/lib/services/invitation-service";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import { setActiveTeamCookieServer } from "@/lib/cookies/active-team-server";
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
    return (
      <InviteStatusCard status="invalid" teamName={null} />
    );
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

  if (status !== "valid") {
    console.log(`[invite-dispatch] ${status} token=${tokenShort}`);
    return (
      <InviteStatusCard status={status} teamName={invitation.team_name} />
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const emailsMatch =
      user.email?.toLowerCase() === invitation.email.toLowerCase();

    if (emailsMatch) {
      const { teamId, postAuthPath } = await acceptAndActivate(
        invitationRepo,
        supabase,
        invitation,
        user.id
      );
      await setActiveTeamCookieServer(teamId);
      console.log(
        `[invite-dispatch] accepted token=${tokenShort} user=${user.email} → ${postAuthPath}`
      );
      redirect(postAuthPath);
    }

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
