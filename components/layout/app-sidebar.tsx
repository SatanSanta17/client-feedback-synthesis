"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Pencil,
  MessageSquare,
  Settings,
  ChevronDown,
  MoreHorizontal,
  Menu,
  Sun,
  Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SynthesiserLogo } from "@/components/layout/synthesiser-logo";
import { WorkspaceSwitcher } from "@/components/layout/workspace-switcher";
import { UserMenu } from "@/components/layout/user-menu";
import { NotificationBell } from "@/components/notifications/notification-bell";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/components/providers/auth-provider";
import {
  useActiveStreamCount,
  useHasAnyUnseenCompletion,
} from "@/lib/streaming";
import { useTheme } from "@/lib/hooks/use-theme";

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
    label: "Dashboard",
    href: "/dashboard",
    icon: <BarChart3 className="size-5 shrink-0" />,
  },
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
];

const SETTINGS_ITEMS: { label: string; href: string }[] = [
  { label: "Team Management", href: "/settings/team" },
  { label: "Extraction Prompt", href: "/settings/prompts" },
];

/* ------------------------------------------------------------------ */
/*  Shared sidebar content                                             */
/* ------------------------------------------------------------------ */

interface SidebarContentProps {
  /** Whether text labels are visible (true = expanded, false = icon-only). */
  showLabels: boolean;
  pathname: string;
  settingsOpen: boolean;
  onSettingsToggle: () => void;
  onDropdownOpenChange?: (open: boolean) => void;
  /** Called when a nav link is clicked (used by mobile drawer to close). */
  onNavigate?: () => void;
}

function SidebarContent({
  showLabels,
  pathname,
  settingsOpen,
  onSettingsToggle,
  onDropdownOpenChange,
  onNavigate,
}: SidebarContentProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const ThemeIcon = isDark ? Sun : Moon;
  const isSettingsRouteActive = pathname.startsWith("/settings");

  // Workspace-scoped streaming indicator state for the Chat nav icon
  // (PRD-024 P5.R2). Pulsating when any stream is active in the current
  // workspace; solid when no streams but unseen completions exist; no dot
  // otherwise. Both hooks use primitive selectors / cached refs so this
  // sub-tree only re-renders on actual state transitions.
  const { activeTeamId } = useAuth();
  const teamId = activeTeamId ?? null;
  const activeStreamCount = useActiveStreamCount(teamId);
  const hasUnseen = useHasAnyUnseenCompletion(teamId);
  const isAnyStreaming = activeStreamCount > 0;
  const showChatDot = isAnyStreaming || hasUnseen;
  const chatAriaLabel = isAnyStreaming
    ? "Chat, response generating"
    : hasUnseen
      ? "Chat, new unread response"
      : "Chat";

  return (
    <>
      {/* ---- Logo ---- */}
      <div className="flex h-14 items-center border-b border-[var(--border-default)] px-4">
        <Link href="/capture" onClick={onNavigate} className="flex items-center overflow-hidden">
          <SynthesiserLogo
            variant={showLabels ? "full" : "icon"}
            className={showLabels ? "h-7 w-auto" : "h-6 w-auto"}
          />
        </Link>
      </div>

      {/* ---- Workspace switcher ---- */}
      <div className="border-b border-[var(--border-default)] px-3 py-3">
        <WorkspaceSwitcher collapsed={!showLabels} onOpenChange={onDropdownOpenChange} />
      </div>

      {/* ---- Navigation links ---- */}
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const isChat = item.href === "/chat";

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              title={!showLabels ? item.label : undefined}
              aria-label={isChat ? chatAriaLabel : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-[var(--brand-primary-light)] text-[var(--brand-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
              )}
            >
              <span className="relative flex shrink-0">
                {item.icon}
                {isChat && showChatDot && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[var(--brand-primary)] ring-2 ring-[var(--surface-page)]",
                      isAnyStreaming && "animate-pulse"
                    )}
                  />
                )}
              </span>
              <span
                className={cn(
                  "truncate transition-opacity duration-200",
                  showLabels ? "opacity-100" : "pointer-events-none w-0 overflow-hidden opacity-0"
                )}
              >
                {item.label}
              </span>
            </Link>
          );
        })}

        {/* ---- Settings accordion ---- */}
        <div className="mt-1">
          <button
            type="button"
            onClick={onSettingsToggle}
            title={!showLabels ? "Settings" : undefined}
            className={cn(
              "flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isSettingsRouteActive
                ? "bg-[var(--brand-primary-light)] text-[var(--brand-primary)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
            )}
          >
            <Settings className="size-5 shrink-0" />
            <span
              className={cn(
                "truncate transition-opacity duration-200",
                showLabels ? "opacity-100" : "pointer-events-none w-0 overflow-hidden opacity-0"
              )}
            >
              Settings
            </span>
            {showLabels && (
              <ChevronDown
                className={cn(
                  "ml-auto size-4 transition-transform duration-200",
                  settingsOpen && "rotate-180"
                )}
              />
            )}
          </button>

          {settingsOpen && showLabels && (
            <div className="mt-1 flex flex-col gap-0.5 pl-5">
              {SETTINGS_ITEMS.map((item) => {
                const isActive = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-[var(--brand-primary-light)] font-medium text-[var(--brand-primary)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </nav>

      {/* ---- Bottom section ---- */}
      <div className="flex flex-col gap-1 border-t border-[var(--border-default)] px-3 py-3">
        {/* More menu — currently houses the theme toggle */}
        <DropdownMenu onOpenChange={onDropdownOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={!showLabels ? "More" : undefined}
              className="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--text-primary)]"
            >
              <MoreHorizontal className="size-5 shrink-0" />
              <span
                className={cn(
                  "truncate transition-opacity duration-200",
                  showLabels ? "opacity-100" : "pointer-events-none w-0 overflow-hidden opacity-0"
                )}
              >
                More
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-48">
            <DropdownMenuItem
              onClick={toggleTheme}
              className="cursor-pointer"
            >
              <ThemeIcon className="mr-2 size-4" />
              {isDark ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Notifications bell (PRD-029 Part 2) */}
        <NotificationBell
          collapsed={!showLabels}
          onOpenChange={onDropdownOpenChange}
        />

        {/* User menu */}
        <UserMenu side="top" collapsed={!showLabels} onOpenChange={onDropdownOpenChange} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  AppSidebar                                                         */
/* ------------------------------------------------------------------ */

export function AppSidebar({ className }: AppSidebarProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openDropdownCount = useRef(0);

  const handleSettingsToggle = useCallback(() => {
    setSettingsOpen((prev) => !prev);
  }, []);

  /** Track dropdown open/close so mouseleave doesn't collapse the sidebar
   *  while a portal-mounted dropdown is still visible. */
  const handleDropdownOpenChange = useCallback((open: boolean) => {
    openDropdownCount.current += open ? 1 : -1;
    if (!open && openDropdownCount.current <= 0) {
      openDropdownCount.current = 0;
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

  /** Close mobile drawer on navigation */
  const handleMobileNavigate = useCallback(() => {
    setMobileOpen(false);
  }, []);

  /* Close mobile drawer and reset settings accordion when pathname changes */
  useEffect(() => {
    setMobileOpen(false);
    setSettingsOpen(false);
  }, [pathname]);

  return (
    <>
      {/* ---- Desktop sidebar (hover-to-expand overlay) ---- */}
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
        <SidebarContent
          showLabels={expanded}
          pathname={pathname}
          settingsOpen={settingsOpen}
          onSettingsToggle={handleSettingsToggle}
          onDropdownOpenChange={handleDropdownOpenChange}
        />
      </aside>

      {/* ---- Mobile hamburger trigger ---- */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-50 flex size-10 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--surface-page)] shadow-sm md:hidden"
        aria-label="Open navigation menu"
      >
        <Menu className="size-5 text-[var(--text-primary)]" />
      </button>

      {/* ---- Mobile drawer ---- */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[var(--sidebar-width-expanded)] bg-[var(--surface-page)] p-0"
        >
          <SidebarContent
            showLabels
            pathname={pathname}
            settingsOpen={settingsOpen}
            onSettingsToggle={handleSettingsToggle}
            onNavigate={handleMobileNavigate}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
