import { getInvitationByToken } from "@/lib/services/invitation-service";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { InvitePageContent } from "./_components/invite-page-content";

interface InvitePageProps {
  params: Promise<{ token: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { token } = await params;
  const result = await getInvitationByToken(token);

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
    const supabase = createServiceRoleClient();
    const { data: profile } = await supabase
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
