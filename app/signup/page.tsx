import type { Metadata } from "next";
import { resolveInvitedEmailFromParam } from "@/lib/invite/resolve";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = {
  title: "Sign Up — Synthesiser",
};

interface SignupPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const { invite } = await searchParams;
  const resolved = await resolveInvitedEmailFromParam(invite);

  return (
    <SignupForm
      invitedEmail={resolved?.invitedEmail ?? null}
      inviteToken={resolved?.token ?? null}
    />
  );
}
