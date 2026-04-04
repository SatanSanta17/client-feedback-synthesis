"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2 } from "lucide-react";
import { InviteShell, InviteHeader } from "./invite-shell";

interface InviteMismatchCardProps {
  teamName: string | null;
  role: string | null;
  invitedEmail: string;
  userEmail: string;
}

export function InviteMismatchCard({
  teamName,
  role,
  invitedEmail,
  userEmail,
}: InviteMismatchCardProps) {
  const [signingOut, setSigningOut] = useState(false);
  const supabase = createClient();

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <InviteShell>
      <InviteHeader teamName={teamName} role={role} />
      <div className="mt-6 w-full space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-left">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
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
