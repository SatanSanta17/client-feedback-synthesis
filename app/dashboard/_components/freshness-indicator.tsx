"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// FreshnessIndicator — subtle "Data as of HH:MM" / "Updated Nm ago" label
// that auto-refreshes every 30 seconds.
// ---------------------------------------------------------------------------

interface FreshnessIndicatorProps {
  /** Epoch millis of the most recent successful widget fetch, or null if
   *  no fetch has completed yet. */
  lastFetchedAt: number | null;
  className?: string;
}

function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  // Older than 1 hour — show absolute time
  const date = new Date(ts);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FreshnessIndicator({
  lastFetchedAt,
  className,
}: FreshnessIndicatorProps) {
  const [, setTick] = useState(0);

  // Re-render every 30 seconds to keep the relative time fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (lastFetchedAt === null) return null;

  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs text-[var(--text-tertiary)]", className)}
    >
      <Clock className="h-3 w-3" />
      Data as of {formatRelativeTime(lastFetchedAt)}
    </span>
  );
}
