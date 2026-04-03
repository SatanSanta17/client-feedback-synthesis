"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronDown, User, Users } from "lucide-react";

interface TeamEntry {
  id: string;
  name: string;
  role: string;
}

function getActiveTeamId(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)active_team_id=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setActiveTeamCookie(teamId: string | null) {
  if (teamId) {
    document.cookie = `active_team_id=${teamId}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  } else {
    document.cookie = "active_team_id=; path=/; max-age=0; SameSite=Lax";
  }
}

export function WorkspaceSwitcher() {
  const [teams, setTeams] = useState<TeamEntry[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setActiveTeamId(getActiveTeamId());

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
      setActiveTeamCookie(teamId);
      setActiveTeamId(teamId);
      router.refresh();
    },
    [activeTeamId, router]
  );

  if (!loaded || teams.length === 0) return null;

  const activeTeam = teams.find((t) => t.id === activeTeamId);
  const displayName = activeTeam ? activeTeam.name : "Personal";

  return (
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

        <DropdownMenuSeparator />

        {teams.map((team) => (
          <DropdownMenuItem
            key={team.id}
            onClick={() => handleSwitch(team.id)}
            className="cursor-pointer"
          >
            <Users className="size-4 text-[var(--text-secondary)]" />
            <span className="flex-1 truncate">{team.name}</span>
            <Badge variant="secondary" className="ml-1 text-[10px] capitalize">
              {team.role}
            </Badge>
            {activeTeamId === team.id && (
              <Check className="size-4 text-[var(--brand-primary)]" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
