"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Pencil,
  MessageSquare,
  Settings,
  MoreHorizontal,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/hooks/use-theme";
import { SynthesiserLogo } from "@/components/layout/synthesiser-logo";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AppSidebarProps {
  className?: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Nav config                                                         */
/* ------------------------------------------------------------------ */

const NAV_ITEMS: NavItem[] = [
  {
    label: "Capture",
    href: "/capture",
    icon: <Pencil className="size-5 shrink-0" />,
  },
  {
    label: "Chat",
    href: "/chat",
    icon: <MessageSquare className="size-5 shrink-0" />,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: <Settings className="size-5 shrink-0" />,
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AppSidebar({ className }: AppSidebarProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const openDropdownCount = useRef(0);

  const isDark = theme === "dark";
  const ThemeIcon = isDark ? Sun : Moon;

  /** Track dropdown open/close so mouseleave doesn't collapse the sidebar
   *  while a portal-mounted dropdown is still visible. */
  const handleDropdownOpenChange = useCallback((open: boolean) => {
    openDropdownCount.current += open ? 1 : -1;
    if (!open && openDropdownCount.current <= 0) {
      openDropdownCount.current = 0;
      // Collapse after a short delay to let the mouse re-enter if it's
      // moving back from the dropdown into the sidebar.
      setTimeout(() => {
        if (openDropdownCount.current === 0) {
          setExpanded(false);
        }
      }, 100);
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (openDropdownCount.current > 0) return;
    setExpanded(false);
  }, []);

  return (
    <aside
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-[var(--border-default)] bg-[var(--surface-page)] transition-all duration-200 md:flex",
        expanded
          ? "w-[var(--sidebar-width-expanded)] shadow-lg"
          : "w-[var(--sidebar-width-collapsed)]",
        className
      )}
    >
      {/* ---- Logo ---- */}
      <div className="flex h-14 items-center border-b border-[var(--border-default)] px-4">
        <Link href="/capture" className="flex items-center overflow-hidden">
          <SynthesiserLogo
            variant={expanded ? "full" : "icon"}
            className={expanded ? "h-7 w-auto" : "h-6 w-auto"}
          />
        </Link>
      </div>

      {/* ---- Workspace switcher ---- */}
      <div className="border-b border-[var(--border-default)] px-3 py-3">
        <WorkspaceSwitcher collapsed={!expanded} onOpenChange={handleDropdownOpenChange} />
      </div>

      {/* ---- Navigation links ---- */}
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={!expanded ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--brand-primary-light)] text-[var(--brand-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
              )}
            >
              {item.icon}
              <span
                className={cn(
                  "truncate transition-opacity duration-200",
                  expanded ? "opacity-100" : "pointer-events-none w-0 overflow-hidden opacity-0"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* ---- Bottom section ---- */}
      <div className="flex flex-col gap-1 border-t border-[var(--border-default)] px-3 py-3">
        {/* More menu */}
        <DropdownMenu onOpenChange={handleDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={!expanded ? "More" : undefined}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
              )}
            >
              <MoreHorizontal className="size-5 shrink-0" />
              <span
                className={cn(
                  "truncate transition-opacity duration-200",
                  expanded ? "opacity-100" : "pointer-events-none w-0 overflow-hidden opacity-0"
                )}
              >
                More
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuItem
              onClick={() => setTheme(isDark ? "light" : "dark")}
              className="cursor-pointer"
            >
              <ThemeIcon className="mr-2 size-4" />
              {isDark ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <UserMenu side="top" collapsed={!expanded} onOpenChange={handleDropdownOpenChange} />
      </div>
    </aside>
  );
}
