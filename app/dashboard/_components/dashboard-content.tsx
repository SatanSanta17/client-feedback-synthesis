"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { cn } from "@/lib/utils";
import { FilterBar } from "./filter-bar";
import { SentimentWidget } from "./sentiment-widget";
import { UrgencyWidget } from "./urgency-widget";
import { SessionVolumeWidget } from "./session-volume-widget";
import { CompetitiveMentionsWidget } from "./competitive-mentions-widget";
import { ClientHealthWidget } from "./client-health-widget";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardContentProps {
  className?: string;
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
        <ClientHealthWidget />
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
