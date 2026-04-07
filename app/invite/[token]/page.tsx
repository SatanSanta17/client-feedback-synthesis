import { getInvitationByToken } from "@/lib/services/invitation-service";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import { InvitePageContent } from "./_components/invite-page-content";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;

  const supabase = await createClient();
  const serviceClient = createServiceRoleClient();
  const invitationRepo = createInvitationRepository(supabase, serviceClient);

  const result = await getInvitationByToken(invitationRepo, token);

  if (!result) {
    return (
      <InvitePageContent
        status="invalid"
        token={token}
        teamName={null}
        role={null}
        invitedEmail={null}
        userExists={false}
      />
    );
  }

  const { invitation, status } = result;

  let userExists = false;

  if (status === "valid") {
    const { data: profile } = await serviceClient
      .from("profiles")
      .select("id")
      .eq("email", invitation.email.toLowerCase())
      .maybeSingle();

    userExists = !!profile;
  }

  return (
    <InvitePageContent
      status={status}
      token={token}
      teamName={invitation.team_name}
      role={invitation.role}
      invitedEmail={invitation.email}
      userExists={userExists}
    />
  );
}
