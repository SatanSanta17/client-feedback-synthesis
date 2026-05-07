"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { EmailConfirmationPanel } from "@/components/auth/email-confirmation-panel";
import { appendInviteParam } from "@/lib/invite/url";

const signupSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupFields = z.infer<typeof signupSchema>;

interface SignupFormProps {
  invitedEmail?: string | null;
  inviteToken?: string | null;
}

export function SignupForm({
  invitedEmail = null,
  inviteToken = null,
}: SignupFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const isInviteMode = !!(invitedEmail && inviteToken);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupFields>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      email: invitedEmail ?? "",
      password: "",
      confirmPassword: "",
    },
  });

  async function onSubmit(data: SignupFields) {
    setServerError(null);

    if (isInviteMode) {
      const response = await fetch(`/api/invite/${inviteToken}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: data.password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        setServerError(body.message ?? "Could not complete signup");
        return;
      }

      const { postAuthPath } = (await response.json()) as {
        postAuthPath: string;
      };
      router.push(postAuthPath);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    setConfirmedEmail(data.email);
  }

  async function handleGoogleSignUp() {
    const callbackPath = appendInviteParam("/auth/callback", inviteToken);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}${callbackPath}`,
      },
    });
  }

  if (confirmedEmail) {
    return (
      <EmailConfirmationPanel>
        We&apos;ve sent a confirmation link to{" "}
        <strong>{confirmedEmail}</strong>. Click the link in your email to
        activate your account.
      </EmailConfirmationPanel>
    );
  }

  return (
    <AuthFormShell
      title="Synthesiser"
      subtitle={
        isInviteMode
          ? "Create your account to accept your invitation."
          : "Create your account to get started."
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
            readOnly={isInviteMode}
            className={
              isInviteMode
                ? "bg-[var(--surface-secondary)] text-[var(--text-muted)]"
                : undefined
            }
            {...register("email")}
          />
          {errors.email && (
            <p className="text-xs text-[var(--status-error)]">{errors.email.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <PasswordInput
            id="password"
            placeholder="password"
            autoComplete="new-password"
            {...register("password")}
          />
          {errors.password && (
            <p className="text-xs text-[var(--status-error)]">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm Password</Label>
          <PasswordInput
            id="confirmPassword"
            placeholder="Re-enter your password"
            autoComplete="new-password"
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-[var(--status-error)]">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {serverError && (
          <p className="text-xs text-[var(--status-error)]">{serverError}</p>
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
          ) : isInviteMode ? (
            "Create Account & Join"
          ) : (
            "Create Account"
          )}
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-[var(--border-default)]" />
        <span className="text-xs text-[var(--text-muted)]">or</span>
        <div className="h-px flex-1 bg-[var(--border-default)]" />
      </div>

      <Button
        onClick={handleGoogleSignUp}
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
          href={appendInviteParam("/login", inviteToken)}
          className="font-medium text-[var(--brand-primary)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthFormShell>
  );
}
