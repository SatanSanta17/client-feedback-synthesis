import { redirect } from "next/navigation";

export const metadata = {
  title: "Settings — Synthesiser",
};

export default function SettingsPage() {
  redirect("/settings/team");
}
