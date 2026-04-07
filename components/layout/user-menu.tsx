"use client";

import Image from "next/image";
import Link from "next/link";
import { LogOut, Moon, Sun, User } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useTheme } from "@/lib/hooks/use-theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="h-8 w-8 animate-pulse rounded-full bg-[var(--surface-raised)]" />
        <div className="h-4 w-20 animate-pulse rounded bg-[var(--surface-raised)]" />
      </div>
    );
  }

  // Not authenticated — show sign-in link
  if (!isAuthenticated || !user) {
    return (
      <Link
        href="/login"
        className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)]">
          <User className="h-4 w-4" />
        </div>
        <span>Sign in</span>
      </Link>
    );
  }

  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;
  const fullName = (user.user_metadata?.full_name as string) ?? user.email;
  const email = user.email ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-raised)] focus:outline-none"
        >
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
          <span className="max-w-[160px] truncate">{email}</span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {fullName}
          </p>
          <p className="text-xs text-[var(--text-muted)]">{email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="cursor-pointer"
        >
          {theme === "dark" ? (
            <Sun className="mr-2 h-4 w-4" />
          ) : (
            <Moon className="mr-2 h-4 w-4" />
          )}
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </DropdownMenuItem>
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
