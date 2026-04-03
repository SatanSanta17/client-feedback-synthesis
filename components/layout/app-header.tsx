"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { TabNav } from "@/components/layout/tab-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { CreateTeamDialog } from "@/components/layout/create-team-dialog";

export function AppHeader() {
  const pathname = usePathname();
  const { canCreateTeam, isAuthenticated } = useAuth();

  if (pathname === "/login") return null;

  return (
    <header className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-page)] px-6">
      <div className="flex items-center gap-6">
        <span className="text-base font-semibold text-[var(--text-primary)]">
          Synthesiser
        </span>
        <TabNav />
      </div>
      <div className="flex items-center gap-3">
        {isAuthenticated && canCreateTeam && <CreateTeamDialog />}
        <UserMenu />
      </div>
    </header>
  );
}
