"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Pencil, BarChart3, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";

interface TabConfig {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const baseTabs: TabConfig[] = [
  {
    label: "Capture",
    href: "/capture",
    icon: <Pencil className="h-4 w-4" />,
  },
  {
    label: "Master Signals",
    href: "/m-signals",
    icon: <BarChart3 className="h-4 w-4" />,
  },
];

const settingsTab: TabConfig = {
  label: "Settings",
  href: "/settings",
  icon: <Settings className="h-4 w-4" />,
};

export function TabNav() {
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  const tabs = isAdmin ? [...baseTabs, settingsTab] : baseTabs;

  return (
    <nav className="flex items-center gap-1" aria-label="Main navigation">
      {tabs.map((tab) => {
        const isActive = pathname.startsWith(tab.href);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors",
              isActive
                ? "text-[var(--brand-primary)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            )}
          >
            {tab.icon}
            {tab.label}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--brand-primary)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
