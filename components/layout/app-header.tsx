"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { SynthesiserLogo } from "@/components/layout/synthesiser-logo";
import { TabNav } from "@/components/layout/tab-nav";
import { UserMenu } from "@/components/layout/user-menu";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";

export function AppHeader() {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  const isAuthPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password";

  if (isAuthPage) return null;

  return (
    <header className="flex items-center justify-between border-b border-[var(--border-default)] bg-[var(--surface-page)] px-6">
      <div className="flex items-center gap-6">
        <SynthesiserLogo variant="full" className="h-7 w-auto" />
        {isAuthenticated && <WorkspaceSwitcher />}
        <TabNav />
      </div>
      <div className="flex items-center gap-3">
        <UserMenu />
      </div>
    </header>
  );
}
