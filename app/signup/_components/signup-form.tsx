"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleIcon } from "@/components/ui/google-icon";
import { passwordField } from "@/lib/schemas/password-schema";

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
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
        <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
            <CheckCircle2 className="size-6 text-green-500" />
          </div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Check your email
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            We&apos;ve sent a confirmation link to{" "}
            <strong>{confirmedEmail}</strong>. Click the link in your email to
            activate your account.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm font-medium text-[var(--brand-primary)] hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Synthesiser
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Create your account to get started.
          </p>
        </div>

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
              <p className="text-xs text-red-500">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Min 8 chars, 1 number, 1 special"
              autoComplete="new-password"
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-red-500">{errors.password.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm Password</Label>
            <Input
              id="confirmPassword"
              type="password"
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
      </div>
    </div>
  );
}
