"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, Plus, User, Users } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { CreateTeamDialog } from "@/components/layout/create-team-dialog";

interface TeamEntry {
  id: string;
  name: string;
  role: string;
}

export function WorkspaceSwitcher() {
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { canCreateTeam, activeTeamId, setActiveTeam } = useAuth();

  useEffect(() => {
    fetch("/api/teams")
      .then((res) => (res.ok ? res.json() : { teams: [] }))
      .then((data) => {
        setTeams(data.teams ?? []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const handleSwitch = useCallback(
    (teamId: string | null) => {
      if (teamId === activeTeamId) return;
      setActiveTeam(teamId);
    },
    [activeTeamId, setActiveTeam]
  );

  if (!loaded) {
    return (
      <div className="h-8 w-28 animate-pulse rounded-md bg-[var(--surface-raised)]" />
    );
  }

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const displayName = activeTeam ? activeTeam.name : "Personal";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex cursor-pointer items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-raised)]">
            {activeTeam ? (
              <Users className="size-3.5 text-[var(--text-secondary)]" />
            ) : (
              <User className="size-3.5 text-[var(--text-secondary)]" />
            )}
            <span className="max-w-[140px] truncate">{displayName}</span>
            <ChevronDown className="size-3.5 text-[var(--text-muted)]" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            onClick={() => handleSwitch(null)}
            className="cursor-pointer"
          >
            <User className="size-4 text-[var(--text-secondary)]" />
            <span className="flex-1">Personal</span>
            {!activeTeamId && (
              <Check className="size-4 text-[var(--brand-primary)]" />
            )}
          </DropdownMenuItem>

          {teams.length > 0 && <DropdownMenuSeparator />}

          {teams.map((team) => (
            <DropdownMenuItem
              key={team.id}
              onClick={() => handleSwitch(team.id)}
              className="cursor-pointer"
            >
              <Users className="size-4 text-[var(--text-secondary)]" />
              <span className="flex-1 truncate">{team.name}</span>
              <Badge variant="secondary" className="ml-1 text-xs capitalize">
                {team.role}
              </Badge>
              {activeTeamId === team.id && (
                <Check className="size-4 text-[var(--brand-primary)]" />
              )}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          {canCreateTeam ? (
            <DropdownMenuItem
              onClick={() => setCreateOpen(true)}
              className="cursor-pointer"
            >
              <Plus className="size-4 text-[var(--text-secondary)]" />
              <span className="flex-1">Create Team</span>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled className="text-xs text-[var(--text-muted)]">
              <Plus className="size-4 text-[var(--text-muted)]" />
              <span className="flex-1">Team workspaces — contact us</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
