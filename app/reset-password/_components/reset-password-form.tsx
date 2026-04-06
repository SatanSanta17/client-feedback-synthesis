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
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { passwordField } from "@/lib/schemas/password-schema";

const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ResetPasswordFields = z.infer<typeof resetPasswordSchema>;

export function ResetPasswordForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFields>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  async function onSubmit(data: ResetPasswordFields) {
    setServerError(null);

    const { error } = await supabase.auth.updateUser({
      password: data.password,
    });

    if (error) {
      setServerError(error.message);
      return;
    }

    toast.success("Password updated successfully");
    router.push("/capture");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-page)]">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border-default)] bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Reset your password
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">
            Enter your new password below.
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="password">New Password</Label>
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
            <Label htmlFor="confirmPassword">Confirm New Password</Label>
            <PasswordInput
              id="confirmPassword"
              placeholder="Re-enter your new password"
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
                Updating…
              </>
            ) : (
              "Reset Password"
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
      </div>
    </div>
  );
}
