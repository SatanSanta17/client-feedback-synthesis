import { redirect } from "next/navigation";
import { getActiveTeamId, createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { ExtractionPromptClient } from "./_components/extraction-prompt-client";

export const metadata = {
  title: "Extraction Prompt — Synthesiser",
};

export default async function ExtractionPromptPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const activeTeamId = await getActiveTeamId();
  let isAdmin = true;

  if (activeTeamId) {
    const { data: member } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", activeTeamId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!member) {
      return (
        <div className="flex flex-1 flex-col p-6 w-full max-w-4xl">
          <PageHeader 
            title="Extraction Prompt" 
            description="Edit the AI system prompt used for session signal extraction." 
          />
          <div className="mt-8">
            <p className="text-sm text-[var(--text-secondary)]">
              You do not have access to this team.
            </p>
          </div>
        </div>
      );
    }
    
    isAdmin = member.role === "admin";
  }

  return (
    <div className="flex flex-1 flex-col p-6 w-full h-full max-h-screen">
      <PageHeader 
        title="Extraction Prompt" 
        description="Edit the AI system prompt used for session signal extraction." 
      />
      <ExtractionPromptClient readOnly={!isAdmin} />
    </div>
  );
}
