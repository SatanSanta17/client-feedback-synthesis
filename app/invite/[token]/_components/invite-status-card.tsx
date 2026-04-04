"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { InvitationStatus } from "@/lib/services/invitation-service";
import { InviteShell, StatusIcon } from "./invite-shell";

interface InviteStatusCardProps {
  status: Extract<InvitationStatus, "invalid" | "expired" | "already_accepted">;
  teamName: string | null;
}

export function InviteStatusCard({ status, teamName }: InviteStatusCardProps) {
  const router = useRouter();

  if (status === "invalid") {
    return (
      <InviteShell>
        <StatusIcon variant="error" />
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Invalid Invitation
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          This invitation link is invalid. Please check the link or ask the team
          admin to send a new one.
        </p>
      </InviteShell>
    );
  }

  if (status === "expired") {
    return (
      <InviteShell>
        <StatusIcon variant="expired" />
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Invitation Expired
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          This invitation to <strong>{teamName}</strong> has expired. Ask the
          team admin to send a new one.
        </p>
      </InviteShell>
    );
  }

  return (
    <InviteShell>
      <StatusIcon variant="accepted" />
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">
        Already Accepted
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        This invitation has already been used. If you&apos;re already a member
        of <strong>{teamName}</strong>, sign in to continue.
      </p>
      <Button
        onClick={() => router.push("/login")}
        className="mt-6 w-full cursor-pointer"
        variant="default"
        size="lg"
      >
        Go to Sign In
      </Button>
    </InviteShell>
  );
}
