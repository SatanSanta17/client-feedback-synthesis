"use client";

import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { DashboardCard } from "./dashboard-card";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardContentProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// Placeholder widget cards (replaced in Increments 2.3–2.6)
// ---------------------------------------------------------------------------

function PlaceholderWidget({ title }: { title: string }) {
  return (
    <DashboardCard
      title={title}
      isLoading={false}
      error={null}
      isEmpty
      emptyMessage="Widget coming soon"
    >
      {null}
    </DashboardCard>
  );
}

// ---------------------------------------------------------------------------
// DashboardContent
// ---------------------------------------------------------------------------

export function DashboardContent({ className }: DashboardContentProps) {
  // Read search params so widgets can react to global filter changes
  const searchParams = useSearchParams();

  // Placeholder — filters will be wired in Increment 2.3
  void searchParams;

  return (
    <div className={cn("flex flex-1 flex-col gap-6", className)}>
      {/* Filter bar placeholder — Increment 2.3 */}
      <div className="rounded-lg border border-dashed border-[var(--border-default)] px-4 py-3 text-sm text-[var(--text-tertiary)]">
        Filters will appear here
      </div>

      {/* Responsive widget grid: 1 col mobile, 2 col md, 3 col lg */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <PlaceholderWidget title="Sentiment Distribution" />
        <PlaceholderWidget title="Urgency Distribution" />
        <PlaceholderWidget title="Session Volume Over Time" />
        <PlaceholderWidget title="Client Health Grid" />
        <PlaceholderWidget title="Competitive Mentions" />
      </div>
    </div>
  );
}
