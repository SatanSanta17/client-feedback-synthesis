"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/components/providers/auth-provider";
import type { InvitationStatus } from "@/lib/services/invitation-service";
import { InviteShell, InviteHeader } from "./invite-shell";
import { InviteStatusCard } from "./invite-status-card";
import { InviteAcceptCard } from "./invite-accept-card";
import { InviteMismatchCard } from "./invite-mismatch-card";
import { InviteSignInForm } from "./invite-sign-in-form";
import { InviteSignUpForm } from "./invite-sign-up-form";

interface InvitePageContentProps {
  status: InvitationStatus;
  token: string;
  teamName: string | null;
  role: string | null;
  invitedEmail: string | null;
  userExists: boolean;
}

export function InvitePageContent({
  status,
  token,
  teamName,
  role,
  invitedEmail,
  userExists,
}: InvitePageContentProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("error") === "email_mismatch") {
      toast.error(
        "You signed in with a different email than the invitation was sent to"
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  if (status !== "valid") {
    return <InviteStatusCard status={status} teamName={teamName} />;
  }

  if (isLoading) {
    return (
      <InviteShell>
        <InviteHeader teamName={teamName} role={role} />
      </InviteShell>
    );
  }

  const emailsMatch =
    isAuthenticated &&
    user?.email?.toLowerCase() === invitedEmail?.toLowerCase();

  if (isAuthenticated && emailsMatch) {
    return (
      <InviteAcceptCard
        token={token}
        teamName={teamName}
        role={role}
        userEmail={user!.email!}
      />
    );
  }

  if (isAuthenticated) {
    return (
      <InviteMismatchCard
        teamName={teamName}
        role={role}
        invitedEmail={invitedEmail!}
        userEmail={user!.email!}
      />
    );
  }

  if (userExists) {
    return (
      <InviteSignInForm
        token={token}
        teamName={teamName}
        role={role}
        invitedEmail={invitedEmail!}
      />
    );
  }

  return (
    <InviteSignUpForm
      token={token}
      teamName={teamName}
      role={role}
      invitedEmail={invitedEmail!}
    />
  );
}
