"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, Clock, CheckCircle2, Users } from "lucide-react";
import { GoogleIcon } from "@/components/ui/google-icon";
import type { InvitationStatus } from "@/lib/services/invitation-service";

interface InvitePageContentProps {
  status: InvitationStatus;
  token: string;
  teamName: string | null;
  role: string | null;
}

const PENDING_INVITE_COOKIE_TTL = 60 * 10; // 10 minutes

function setInviteCookie(token: string) {
  document.cookie = `pending_invite_token=${token}; path=/; max-age=${PENDING_INVITE_COOKIE_TTL}; SameSite=Lax`;
}

function setActiveTeamCookie(teamId: string) {
  document.cookie = `active_team_id=${teamId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

export function InvitePageContent({
  status,
  token,
  teamName,
  role,
}: InvitePageContentProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [accepting, setAccepting] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSignInToJoin() {
    setInviteCookie(token);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  async function handleAcceptDirectly() {
    setAccepting(true);
    try {
      const response = await fetch(`/api/invite/${token}/accept`, {
        method: "POST",
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message ?? "Failed to accept invitation");
      }

      const { teamId } = await response.json();
      setActiveTeamCookie(teamId);
      toast.success(`Joined ${teamName}!`);
      router.push("/capture");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
      setAccepting(false);
    }
  }

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

  if (status === "already_accepted") {
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

  return (
    <InviteShell>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-primary-light)]">
        <Users className="size-6 text-[var(--brand-primary)]" />
      </div>
      <h1 className="text-xl font-semibold text-[var(--text-primary)]">
        Join {teamName}
      </h1>
      <p className="mt-2 text-sm text-[var(--text-secondary)]">
        You&apos;ve been invited to join <strong>{teamName}</strong> on
        Synthesiser.
      </p>
      <div className="mt-3">
        <Badge variant="secondary" className="capitalize">
          {role}
        </Badge>
      </div>

      {isLoading ? null : isAuthenticated && user ? (
        <div className="mt-6 w-full space-y-3">
          <p className="text-center text-xs text-[var(--text-muted)]">
            Signed in as {user.email}
          </p>
          <Button
            onClick={handleAcceptDirectly}
            disabled={accepting}
            className="w-full cursor-pointer"
            variant="default"
            size="lg"
          >
            {accepting ? "Joining…" : "Accept & Join Team"}
          </Button>
        </div>
      ) : (
        <Button
          onClick={handleSignInToJoin}
          className="mt-6 w-full cursor-pointer"
          variant="default"
          size="lg"
        >
          <GoogleIcon className="mr-2 h-5 w-5" />
          Sign in with Google to join
        </Button>
      )}
    </InviteShell>
  );
}

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 text-center shadow-sm">
        <div className="flex flex-col items-center">{children}</div>
      </div>
    </div>
  );
}

function StatusIcon({ variant }: { variant: "error" | "expired" | "accepted" }) {
  const config = {
    error: { icon: AlertCircle, bg: "bg-red-50", text: "text-red-500" },
    expired: { icon: Clock, bg: "bg-amber-50", text: "text-amber-500" },
    accepted: { icon: CheckCircle2, bg: "bg-green-50", text: "text-green-500" },
  }[variant];

  const Icon = config.icon;

  return (
    <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${config.bg}`}>
      <Icon className={`size-6 ${config.text}`} />
    </div>
  );
}

