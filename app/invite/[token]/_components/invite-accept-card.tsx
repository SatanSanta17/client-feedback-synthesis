"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InviteShell, InviteHeader } from "./invite-shell";
import { acceptInviteApi, setActiveTeamCookie } from "./invite-helpers";

interface InviteAcceptCardProps {
  token: string;
  teamName: string | null;
  role: string | null;
  userEmail: string;
}

export function InviteAcceptCard({
  token,
  teamName,
  role,
  userEmail,
}: InviteAcceptCardProps) {
  const [accepting, setAccepting] = useState(false);
  const router = useRouter();

  async function handleAccept() {
    setAccepting(true);
    try {
      const { teamId } = await acceptInviteApi(token);
      setActiveTeamCookie(teamId);
      toast.success(`Joined ${teamName}!`);
      router.push("/capture");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setAccepting(false);
    }
  }

  return (
    <InviteShell>
      <InviteHeader teamName={teamName} role={role} />
      <div className="mt-6 w-full space-y-3">
        <p className="text-center text-xs text-[var(--text-muted)]">
          Signed in as {userEmail}
        </p>
        <Button
          onClick={handleAccept}
          disabled={accepting}
          className="w-full cursor-pointer"
          variant="default"
          size="lg"
        >
          {accepting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Joining…
            </>
          ) : (
            "Accept & Join Team"
          )}
        </Button>
      </div>
    </InviteShell>
  );
}
