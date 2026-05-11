import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { AuthProvider } from "@/components/providers/auth-provider";
import { InviteOutcomeToast } from "@/components/invite/invite-outcome-toast";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Synthesiser",
  description:
    "Capture and synthesise client feedback with AI-powered signal extraction",
  icons: {
    icon: "/icon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get("theme")?.value;
  const isDark = themeCookie === "dark";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        geistSans.variable,
        geistMono.variable,
        "h-full scroll-smooth antialiased",
        isDark && "dark"
      )}
    >
      <body className="flex min-h-full flex-col bg-[var(--surface-page)] text-[var(--text-primary)]">
        <Analytics />
        <AuthProvider>
          <AuthenticatedLayout>
            {children}
          </AuthenticatedLayout>
          <Toaster position="bottom-right" richColors />
          <Suspense fallback={null}>
            <InviteOutcomeToast />
          </Suspense>
        </AuthProvider>
      </body>
    </html>
  );
}
