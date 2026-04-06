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
import { AuthFormShell } from "@/components/auth/auth-form-shell";
import { EmailConfirmationPanel } from "@/components/auth/email-confirmation-panel";

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type ForgotPasswordFields = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFields>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(data: ForgotPasswordFields) {
    await supabase.auth.resetPasswordForEmail(data.email, {
      redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
    });

    setSubmittedEmail(data.email);
  }

  if (submittedEmail) {
    return (
      <EmailConfirmationPanel>
        If an account exists for <strong>{submittedEmail}</strong>,
        we&apos;ve sent a password reset link.
      </EmailConfirmationPanel>
    );
  }

  return (
    <AuthFormShell
      title="Forgot password?"
      subtitle="Enter your email and we'll send you a reset link."
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

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full cursor-pointer"
          size="lg"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Sending…
            </>
          ) : (
            "Send Reset Link"
          )}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
        <Link
          href="/login"
          className="font-medium text-[var(--brand-primary)] hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </AuthFormShell>
  );
}
