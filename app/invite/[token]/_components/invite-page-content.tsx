"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/components/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Loader2,
  Users,
} from "lucide-react";
import { GoogleIcon } from "@/components/ui/google-icon";
import type { InvitationStatus } from "@/lib/services/invitation-service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InvitePageContentProps {
  status: InvitationStatus;
  token: string;
  teamName: string | null;
  role: string | null;
  invitedEmail: string | null;
  userExists: boolean;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const inviteSignInSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

type InviteSignInFields = z.infer<typeof inviteSignInSchema>;

const inviteSignUpSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/\d/, "Password must contain at least one number")
      .regex(
        /[^a-zA-Z0-9]/,
        "Password must contain at least one special character"
      ),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type InviteSignUpFields = z.infer<typeof inviteSignUpSchema>;

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const PENDING_INVITE_COOKIE_TTL = 60 * 10; // 10 minutes

function setInviteCookie(token: string) {
  document.cookie = `pending_invite_token=${token}; path=/; max-age=${PENDING_INVITE_COOKIE_TTL}; SameSite=Lax`;
}

function setActiveTeamCookie(teamId: string) {
  document.cookie = `active_team_id=${teamId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvitePageContent({
  status,
  token,
  teamName,
  role,
  invitedEmail,
  userExists,
}: InvitePageContentProps) {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [accepting, setAccepting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  useEffect(() => {
    const error = searchParams.get("error");
    if (error === "email_mismatch") {
      toast.error(
        "You signed in with a different email than the invitation was sent to"
      );
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  // -- Sign-in form (existing user, unauthenticated) -----------------------

  const signInForm = useForm<InviteSignInFields>({
    resolver: zodResolver(inviteSignInSchema),
    defaultValues: { password: "" },
  });

  // -- Sign-up form (new user, unauthenticated) ----------------------------

  const signUpForm = useForm<InviteSignUpFields>({
    resolver: zodResolver(inviteSignUpSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  // -- Handlers -------------------------------------------------------------

  async function handleGoogleOAuth() {
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

  async function handleSignOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    window.location.reload();
  }

  async function onSignIn(data: InviteSignInFields) {
    setServerError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: invitedEmail!,
      password: data.password,
    });

    if (error) {
      const message =
        error.message === "Invalid login credentials"
          ? "Invalid password"
          : error.message;
      setServerError(message);
      return;
    }

    await handleAcceptDirectly();
  }

  async function onSignUp(data: InviteSignUpFields) {
    setServerError(null);
    setInviteCookie(token);

    const { error } = await supabase.auth.signUp({
      email: invitedEmail!,
      password: data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    setConfirmedEmail(invitedEmail!);
  }

  // -- Render: non-valid statuses -------------------------------------------

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

  // -- Render: "Check your email" after sign-up -----------------------------

  if (confirmedEmail) {
    return (
      <InviteShell>
        <StatusIcon variant="accepted" />
        <h1 className="text-xl font-semibold text-[var(--text-primary)]">
          Check your email
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          We&apos;ve sent a confirmation link to{" "}
          <strong>{confirmedEmail}</strong>. Click the link to activate your
          account and join <strong>{teamName}</strong>.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-[var(--brand-primary)] hover:underline"
        >
          Back to sign in
        </Link>
      </InviteShell>
    );
  }

  // -- Render: valid status — invite header ---------------------------------

  const inviteHeader = (
    <>
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
    </>
  );

  // -- Render: loading ------------------------------------------------------

  if (isLoading) {
    return <InviteShell>{inviteHeader}</InviteShell>;
  }

  // -- Render: authenticated + email match ----------------------------------

  const emailsMatch =
    isAuthenticated &&
    user?.email?.toLowerCase() === invitedEmail?.toLowerCase();

  if (isAuthenticated && emailsMatch) {
    return (
      <InviteShell>
        {inviteHeader}
        <div className="mt-6 w-full space-y-3">
          <p className="text-center text-xs text-[var(--text-muted)]">
            Signed in as {user?.email}
          </p>
          <Button
            onClick={handleAcceptDirectly}
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

  // -- Render: authenticated + email mismatch -------------------------------

  if (isAuthenticated && !emailsMatch) {
    return (
      <InviteShell>
        {inviteHeader}
        <div className="mt-6 w-full space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-left">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" />
              <div className="space-y-1 text-sm">
                <p className="text-[var(--text-primary)]">
                  This invitation is for{" "}
                  <strong>{invitedEmail}</strong>
                </p>
                <p className="text-[var(--text-secondary)]">
                  You&apos;re signed in as{" "}
                  <strong>{user?.email}</strong>
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

  // -- Render: unauthenticated + existing user → sign-in form ---------------

  if (userExists) {
    return (
      <InviteShell>
        {inviteHeader}
        <form
          onSubmit={signInForm.handleSubmit(onSignIn)}
          className="mt-6 w-full space-y-4 text-left"
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={invitedEmail ?? ""}
              readOnly
              className="bg-[var(--surface-secondary)] text-[var(--text-muted)]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invite-password">Password</Label>
            <Input
              id="invite-password"
              type="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              {...signInForm.register("password")}
            />
            {signInForm.formState.errors.password && (
              <p className="text-xs text-red-500">
                {signInForm.formState.errors.password.message}
              </p>
            )}
          </div>

          {serverError && (
            <p className="text-xs text-red-500">{serverError}</p>
          )}

          <Button
            type="submit"
            disabled={signInForm.formState.isSubmitting || accepting}
            className="w-full cursor-pointer"
            size="lg"
          >
            {signInForm.formState.isSubmitting || accepting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in & Join"
            )}
          </Button>
        </form>

        <OAuthDivider />

        <Button
          onClick={handleGoogleOAuth}
          variant="outline"
          className="w-full cursor-pointer"
          size="lg"
        >
          <GoogleIcon className="mr-2 h-5 w-5" />
          Continue with Google
        </Button>

        <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
          Don&apos;t have an account?{" "}
          <Link
            href="/signup"
            className="font-medium text-[var(--brand-primary)] hover:underline"
          >
            Sign up
          </Link>
        </p>
      </InviteShell>
    );
  }

  // -- Render: unauthenticated + new user → sign-up form --------------------

  return (
    <InviteShell>
      {inviteHeader}
      <form
        onSubmit={signUpForm.handleSubmit(onSignUp)}
        className="mt-6 w-full space-y-4 text-left"
      >
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={invitedEmail ?? ""}
            readOnly
            className="bg-[var(--surface-secondary)] text-[var(--text-muted)]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-password">Password</Label>
          <Input
            id="invite-password"
            type="password"
            placeholder="Min 8 chars, 1 number, 1 special"
            autoComplete="new-password"
            {...signUpForm.register("password")}
          />
          {signUpForm.formState.errors.password && (
            <p className="text-xs text-red-500">
              {signUpForm.formState.errors.password.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-confirm-password">Confirm Password</Label>
          <Input
            id="invite-confirm-password"
            type="password"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            {...signUpForm.register("confirmPassword")}
          />
          {signUpForm.formState.errors.confirmPassword && (
            <p className="text-xs text-red-500">
              {signUpForm.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        {serverError && (
          <p className="text-xs text-red-500">{serverError}</p>
        )}

        <Button
          type="submit"
          disabled={signUpForm.formState.isSubmitting}
          className="w-full cursor-pointer"
          size="lg"
        >
          {signUpForm.formState.isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Creating…
            </>
          ) : (
            "Create Account & Join"
          )}
        </Button>
      </form>

      <OAuthDivider />

      <Button
        onClick={handleGoogleOAuth}
        variant="outline"
        className="w-full cursor-pointer"
        size="lg"
      >
        <GoogleIcon className="mr-2 h-5 w-5" />
        Continue with Google
      </Button>

      <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-[var(--brand-primary)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </InviteShell>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function InviteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 text-center shadow-sm">
        <div className="flex flex-col items-center">{children}</div>
      </div>
    </div>
  );
}

function OAuthDivider() {
  return (
    <div className="my-6 flex items-center gap-3">
      <div className="h-px flex-1 bg-[var(--border-default)]" />
      <span className="text-xs text-[var(--text-muted)]">or</span>
      <div className="h-px flex-1 bg-[var(--border-default)]" />
    </div>
  );
}

function StatusIcon({
  variant,
}: {
  variant: "error" | "expired" | "accepted";
}) {
  const config = {
    error: { icon: AlertCircle, bg: "bg-red-50", text: "text-red-500" },
    expired: { icon: Clock, bg: "bg-amber-50", text: "text-amber-500" },
    accepted: {
      icon: CheckCircle2,
      bg: "bg-green-50",
      text: "text-green-500",
    },
  }[variant];

  const Icon = config.icon;

  return (
    <div
      className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${config.bg}`}
    >
      <Icon className={`size-6 ${config.text}`} />
    </div>
  );
}
