"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { InviteShell, InviteHeader } from "./invite-shell";

interface InviteMismatchCardProps {
  teamName: string | null;
  role: string | null;
  invitedEmail: string;
  userEmail: string;
  inviteToken: string;
}

export function InviteMismatchCard({
  teamName,
  role,
  invitedEmail,
  userEmail,
  inviteToken,
}: InviteMismatchCardProps) {
  const [signingOut, setSigningOut] = useState(false);
  const { signOut } = useAuth();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("error") === "email_mismatch") {
      toast.error(
        "You signed in with a different email than the invitation was sent to"
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut();
    window.location.href = `/invite/${inviteToken}`;
  }

  return (
    <InviteShell>
      <InviteHeader teamName={teamName} role={role} />
      <div className="mt-6 w-full space-y-4">
        <div className="rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-light)] p-4 text-left">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--status-warning)]" />
            <div className="space-y-1 text-sm">
              <p className="text-[var(--text-primary)]">
                This invitation is for <strong>{invitedEmail}</strong>
              </p>
              <p className="text-[var(--text-secondary)]">
                You&apos;re signed in as <strong>{userEmail}</strong>
              </p>
            </div>
          </div>
        </div>
        <Button
          onClick={handleSignOut}
          disabled={signingOut}
          variant="outline"
          className="w-full cursor-pointer"
          size="lg"
        >
          {signingOut ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Signing out…
            </>
          ) : (
            `Sign out and continue as ${invitedEmail}`
          )}
        </Button>
      </div>
    </InviteShell>
  );
}
