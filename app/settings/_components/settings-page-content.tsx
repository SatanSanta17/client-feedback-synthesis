"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/components/providers/auth-provider";
import { createClient } from "@/lib/supabase/client";
import { PromptEditorPageContent } from "./prompt-editor-page-content";
import { TeamSettings } from "./team-settings";

interface TeamContext {
  teamId: string;
  teamName: string;
  isAdmin: boolean;
}

function getActiveTeamId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)active_team_id=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function SettingsPageContent() {
  const { user, isAuthenticated } = useAuth();
  const [teamCtx, setTeamCtx] = useState<TeamContext | null>(null);
  const [isCheckingTeam, setIsCheckingTeam] = useState(true);

  const resolveTeamContext = useCallback(async () => {
    if (!user) {
      setIsCheckingTeam(false);
      return;
    }

    const activeTeamId = getActiveTeamId();
    if (!activeTeamId) {
      setIsCheckingTeam(false);
      return;
    }

    const supabase = createClient();

    const { data: member } = await supabase
      .from("team_members")
      .select("role")
      .eq("team_id", activeTeamId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!member) {
      setIsCheckingTeam(false);
      return;
    }

    const { data: team } = await supabase
      .from("teams")
      .select("id, name")
      .eq("id", activeTeamId)
      .is("deleted_at", null)
      .single();

    if (!team) {
      setIsCheckingTeam(false);
      return;
    }

    setTeamCtx({
      teamId: team.id,
      teamName: team.name,
      isAdmin: member.role === "admin",
    });
    setIsCheckingTeam(false);
  }, [user]);

  useEffect(() => {
    if (isAuthenticated) {
      resolveTeamContext();
    } else {
      setIsCheckingTeam(false);
    }
  }, [isAuthenticated, resolveTeamContext]);

  const isTeamContext = teamCtx !== null;
  const isAdmin = teamCtx?.isAdmin === true;

  if (isCheckingTeam) {
    return (
      <div className="flex flex-1 flex-col p-6">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            Settings
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Loading…
          </p>
        </div>
      </div>
    );
  }

  if (!isTeamContext) {
    return <PromptEditorPageContent />;
  }

  if (!isAdmin) {
    return <PromptEditorPageContent readOnly />;
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          Settings
        </h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Manage AI prompts and team settings.
        </p>
      </div>

      <Tabs defaultValue="prompts" className="flex flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="prompts">AI Prompts</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
        </TabsList>

        <TabsContent value="prompts" className="mt-4 flex flex-1 flex-col">
          <PromptEditorPageContent embedded />
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <TeamSettings
            teamId={teamCtx.teamId}
            teamName={teamCtx.teamName}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
