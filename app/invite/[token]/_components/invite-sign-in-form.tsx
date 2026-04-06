"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { GoogleIcon } from "@/components/ui/google-icon";
import { InviteShell, InviteHeader, OAuthDivider } from "./invite-shell";
import {
  setInviteCookie,
  setActiveTeamCookie,
  acceptInviteApi,
} from "./invite-helpers";

const signInSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

type SignInFields = z.infer<typeof signInSchema>;

interface InviteSignInFormProps {
  token: string;
  teamName: string | null;
  role: string | null;
  invitedEmail: string;
}

export function InviteSignInForm({
  token,
  teamName,
  role,
  invitedEmail,
}: InviteSignInFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInFields>({
    resolver: zodResolver(signInSchema),
    defaultValues: { password: "" },
  });

  async function onSubmit(data: SignInFields) {
    setServerError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: invitedEmail,
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

  async function handleGoogleOAuth() {
    setInviteCookie(token);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  return (
    <InviteShell>
      <InviteHeader teamName={teamName} role={role} />
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="mt-6 w-full space-y-4 text-left"
      >
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={invitedEmail}
            readOnly
            className="bg-[var(--surface-secondary)] text-[var(--text-muted)]"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-password">Password</Label>
          <PasswordInput
            id="invite-password"
            placeholder="Enter your password"
            autoComplete="current-password"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-[var(--status-error)]">{errors.password.message}</p>
          )}
        </div>

        {serverError && (
          <p className="text-xs text-[var(--status-error)]">{serverError}</p>
        )}

        <Button
          type="submit"
          disabled={isSubmitting || accepting}
          className="w-full cursor-pointer"
          size="lg"
        >
          {isSubmitting || accepting ? (
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
