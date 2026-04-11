import type { Metadata } from "next";

import { DashboardContent } from "./_components/dashboard-content";

export const metadata: Metadata = {
  title: "Dashboard | Synthesiser",
  description: "AI-powered insights dashboard for client feedback trends",
};

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col px-4 py-8 md:px-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--text-primary)]">
        Dashboard
      </h1>
      <DashboardContent />
    </div>
  );
}
