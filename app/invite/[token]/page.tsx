import { getInvitationByToken } from "@/lib/services/invitation-service";
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
      />
    );
  }

  const { invitation, status } = result;

  return (
    <InvitePageContent
      status={status}
      token={token}
      teamName={invitation.team_name}
      role={invitation.role}
    />
  );
}
