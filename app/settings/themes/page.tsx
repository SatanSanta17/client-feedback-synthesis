import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getActiveTeamId } from "@/lib/cookies/active-team-server";
import { PageHeader } from "@/components/layout/page-header";

import { ThemesPageContent } from "./_components/themes-page-content";

export const metadata = {
  title: "Themes — Synthesiser",
};

const FORBIDDEN_COPY =
  "Theme management is admin-only. Ask your workspace owner if you need access.";

export default async function ThemesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const activeTeamId = await getActiveTeamId();

  // Personal workspace — owner is implicitly admin.
  let isAdmin = activeTeamId === null;

  if (activeTeamId !== null) {
    const { data: member } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", activeTeamId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    isAdmin = member?.role === "admin";
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-1 flex-col p-6 w-full max-w-4xl">
        <PageHeader
          title="Themes"
          description="Review and clean up duplicate themes across your workspace."
        />
        <div className="mt-8">
          <p className="text-sm text-[var(--text-secondary)]">
            {FORBIDDEN_COPY}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-6 w-full max-w-5xl">
      <PageHeader
        title="Themes"
        description="Review and clean up duplicate themes across your workspace."
      />
      <ThemesPageContent />
    </div>
  );
}
