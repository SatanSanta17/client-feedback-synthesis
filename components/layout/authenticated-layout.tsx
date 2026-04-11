"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { AppFooter } from "@/components/layout/app-footer";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AuthenticatedLayoutProps {
  children: React.ReactNode;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AuthenticatedLayout({ children }: AuthenticatedLayoutProps) {
  const pathname = usePathname();
  const { isAuthenticated } = useAuth();

  const isPublicPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/invite");

  const showSidebar = isAuthenticated && !isPublicPage;

  /* Public pages: no sidebar, footer with theme toggle */
  if (!showSidebar) {
    return (
      <>
        <main className="flex flex-1 flex-col">{children}</main>
        <AppFooter />
      </>
    );
  }

  /* Authenticated pages: sidebar + fixed margin, no footer */
  return (
    <div className="flex h-full">
      <AppSidebar />
      <div className="flex flex-1 flex-col min-h-screen md:ml-[var(--sidebar-width-collapsed)]">
        <main className="flex flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
