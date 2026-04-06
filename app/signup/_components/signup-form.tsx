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
import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { EmailConfirmationPanel } from "@/components/auth/email-confirmation-panel";

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

export function SignupForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupFields>({
    resolver: zodResolver(signupSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  async function onSubmit(data: SignupFields) {
    setServerError(null);

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
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
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
      subtitle="Create your account to get started."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="you@example.com"
            autoComplete="email"
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
          href="/login"
          className="font-medium text-[var(--brand-primary)] hover:underline"
        >
          Sign in
        </Link>
      </p>
    </AuthFormShell>
  );
}
