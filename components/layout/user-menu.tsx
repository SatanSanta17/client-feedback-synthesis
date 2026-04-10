"use client";

import Image from "next/image";
import Link from "next/link";
import { LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UserMenuProps {
  /** Dropdown direction — "bottom" (default) or "top" for sidebar usage. */
  side?: "top" | "bottom";
  /** When true, show avatar only as the trigger (icon-only sidebar). */
  collapsed?: boolean;
  /** Called when the dropdown opens or closes. Used by the sidebar to prevent collapse. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function UserMenu({
  side = "bottom",
  collapsed = false,
  onOpenChange,
  className,
}: UserMenuProps) {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();

  // Loading skeleton
  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 px-3 py-2", className)}>
        <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--surface-raised)]" />
        {!collapsed && (
          <div className="h-4 w-20 animate-pulse rounded bg-[var(--surface-raised)]" />
        )}
      </div>
    );
  }

  // Not authenticated — show sign-in link
  if (!isAuthenticated || !user) {
    return (
      <Link
        href="/login"
        className={cn(
          "flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
          className
        )}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)]">
          <User className="h-4 w-4" />
        </div>
        {!collapsed && <span>Sign in</span>}
      </Link>
    );
  }

  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  const fullName = (user.user_metadata?.full_name as string) ?? user.email;
  const email = user.email ?? "";

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={collapsed ? email : undefined}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] focus:outline-none",
            collapsed && "justify-center",
            className
          )}
        >
          <div className="h-8 w-8 shrink-0">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={fullName ?? "User avatar"}
                width={32}
                height={32}
                className="h-8 w-8 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)]">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
          {!collapsed && (
            <span className="max-w-[140px] truncate">{email}</span>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={side}
        align={side === "top" ? "start" : "end"}
        className="w-56"
      >
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {fullName}
          </p>
          <p className="text-xs text-[var(--text-muted)]">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={signOut}
          className="cursor-pointer"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
