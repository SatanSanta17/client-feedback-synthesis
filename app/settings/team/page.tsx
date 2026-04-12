import { redirect } from "next/navigation";
import { getActiveTeamId, createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
import { TeamManagementClient } from "./_components/team-management-client";

export const metadata = {
  title: "Team Management — Synthesiser",
};

export default async function TeamManagementPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const activeTeamId = await getActiveTeamId();

  if (!activeTeamId) {
    return (
      <div className="flex flex-1 flex-col p-6 w-full max-w-4xl">
        <PageHeader 
          title="Team Management" 
          description="Manage members, invitations, and settings." 
        />
        <div className="mt-8">
          <p className="text-sm text-[var(--text-secondary)]">
            Team management is not available in personal workspaces.
          </p>
        </div>
      </div>
    );
  }

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
          title="Team Management" 
          description="Manage members, invitations, and settings." 
        />
        <div className="mt-8">
          <p className="text-sm text-[var(--text-secondary)]">
            You do not have access to this team.
          </p>
        </div>
      </div>
    );
  }

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, owner_id")
    .eq("id", activeTeamId)
    .is("deleted_at", null)
    .single();

  if (!team) {
    return (
      <div className="flex flex-1 flex-col p-6 w-full max-w-4xl">
        <PageHeader 
          title="Team Management" 
          description="Manage members, invitations, and settings." 
        />
        <div className="mt-8">
          <p className="text-sm text-[var(--text-secondary)]">
            Team not found.
          </p>
        </div>
      </div>
    );
  }

  const isAdmin = member.role === "admin";
  const isOwner = team.owner_id === user.id;

  return (
    <div className="flex flex-1 flex-col p-6">
      <PageHeader 
        title="Team Management" 
        description={`Manage members, invitations, and settings for ${team.name}.`} 
      />
      <TeamManagementClient
        teamId={team.id}
        teamName={team.name}
        ownerId={team.owner_id}
        currentUserId={user.id}
        isOwner={isOwner}
        isAdmin={isAdmin}
      />
    </div>
  );
}
