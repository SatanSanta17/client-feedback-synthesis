import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { DashboardContent } from "./_components/dashboard-content";

export const metadata: Metadata = {
  title: "Dashboard | Synthesiser",
  description: "AI-powered insights dashboard for client feedback trends",
};

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col px-4 py-8 md:px-8">
      <PageHeader title="Dashboard" />
      <DashboardContent />
    </div>
  );
}
