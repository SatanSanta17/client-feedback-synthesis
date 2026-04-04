import type { Metadata } from "next";
import { ResetPasswordForm } from "./_components/reset-password-form";

export const metadata: Metadata = {
  title: "Reset Password — Synthesiser",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
