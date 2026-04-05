"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { GoogleIcon } from "@/components/ui/google-icon";
import { passwordField } from "@/lib/schemas/password-schema";
import {
  InviteShell,
  InviteHeader,
  OAuthDivider,
  StatusIcon,
} from "./invite-shell";
import { setInviteCookie } from "./invite-helpers";

const signUpSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignUpFields = z.infer<typeof signUpSchema>;

interface InviteSignUpFormProps {
  token: string;
  teamName: string | null;
  role: string | null;
  invitedEmail: string;
}

export function InviteSignUpForm({
  token,
  teamName,
  role,
  invitedEmail,
}: InviteSignUpFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpFields>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(data: SignUpFields) {
    setServerError(null);
    setInviteCookie(token);

    const { error } = await supabase.auth.signUp({
      email: invitedEmail,
      password: data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    setConfirmedEmail(invitedEmail);
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
            placeholder="password"
            autoComplete="new-password"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-red-500">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="invite-confirm-password">Confirm Password</Label>
          <PasswordInput
            id="invite-confirm-password"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-red-500">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {serverError && (
          <p className="text-xs text-red-500">{serverError}</p>
        )}

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full cursor-pointer"
          size="lg"
        >
          {isSubmitting ? (
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
