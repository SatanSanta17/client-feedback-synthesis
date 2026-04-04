import type { Metadata } from "next";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "Sign In — Synthesiser",
};

export default function LoginPage() {
  return <LoginForm />;
}
