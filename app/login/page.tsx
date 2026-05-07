import type { Metadata } from "next";
import { resolveInvitedEmailFromParam } from "@/lib/invite/resolve";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "Sign In — Synthesiser",
};

interface LoginPageProps {
  searchParams: Promise<{ invite?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { invite } = await searchParams;
  const resolved = await resolveInvitedEmailFromParam(invite);

  return (
    <LoginForm
      invitedEmail={resolved?.invitedEmail ?? null}
      inviteToken={resolved?.token ?? null}
    />
  );
}
