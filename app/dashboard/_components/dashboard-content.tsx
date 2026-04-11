"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { DashboardCard } from "./dashboard-card";
import { FilterBar } from "./filter-bar";
import { SentimentWidget } from "./sentiment-widget";
import { UrgencyWidget } from "./urgency-widget";
import { SessionVolumeWidget } from "./session-volume-widget";
import { CompetitiveMentionsWidget } from "./competitive-mentions-widget";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardContentProps {
  className?: string;
}

// ---------------------------------------------------------------------------
// Placeholder widget cards (replaced in Increments 2.4–2.6)
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
// Inner content (reads useSearchParams — must be inside Suspense)
// ---------------------------------------------------------------------------

function DashboardInner() {
  // Widgets will consume searchParams to re-fetch on filter changes
  const searchParams = useSearchParams();
  void searchParams;

  return (
    <>
      {/* Global filter bar */}
      <FilterBar />

      {/* Responsive widget grid: 1 col mobile, 2 col md, 3 col lg */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SentimentWidget />
        <UrgencyWidget />
        <SessionVolumeWidget />
        <PlaceholderWidget title="Client Health Grid" />
        <CompetitiveMentionsWidget />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// DashboardContent
// ---------------------------------------------------------------------------

export function DashboardContent({ className }: DashboardContentProps) {
  return (
    <div className={cn("flex flex-1 flex-col gap-6", className)}>
      <Suspense fallback={<div className="h-10 animate-pulse rounded-lg bg-[var(--surface-raised)]" />}>
        <DashboardInner />
      </Suspense>
    </div>
  );
}
