import type { Metadata } from "next";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { createInvitationRepository } from "@/lib/repositories/supabase/supabase-invitation-repository";
import { getInvitationByToken } from "@/lib/services/invitation-service";
import { parseInviteToken } from "@/lib/invite/token";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = {
  title: "Sign Up — Synthesiser",
};

interface SignupPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { invite } = await searchParams;
  const inviteToken = parseInviteToken(invite);

  let invitedEmail: string | null = null;
  let activeInviteToken: string | null = null;

  if (inviteToken) {
    const supabase = await createClient();
    const serviceClient = createServiceRoleClient();
    const repo = createInvitationRepository(supabase, serviceClient);
    const result = await getInvitationByToken(repo, inviteToken);

    if (result?.status === "valid") {
      invitedEmail = result.invitation.email;
      activeInviteToken = inviteToken;
    }
  }

  return (
    <SignupForm invitedEmail={invitedEmail} inviteToken={activeInviteToken} />
  );
}
