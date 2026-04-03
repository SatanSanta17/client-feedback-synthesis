"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertCircle, Clock, CheckCircle2, Users } from "lucide-react";
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
          <GoogleIcon />
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

function GoogleIcon() {
  return (
    <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}
