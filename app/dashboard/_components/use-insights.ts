"use client";

import { useCallback, useEffect, useState } from "react";

import type { DashboardInsight, InsightBatch } from "@/lib/types/insight";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseInsightsResult {
  /** Latest batch of insights (null if none exist). */
  latestBatch: InsightBatch | null;
  isLoading: boolean;
  error: string | null;

  /** Trigger a fresh generation via the POST endpoint, then re-fetch latest. */
  refresh: () => void;
  isRefreshing: boolean;

  /** Previous batches (loaded lazily on first call to loadPrevious). */
  previousBatches: InsightBatch[];
  loadPrevious: () => void;
  isPreviousLoading: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useInsights(): UseInsightsResult {
  const [latestBatch, setLatestBatch] = useState<InsightBatch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const [previousBatches, setPreviousBatches] = useState<InsightBatch[]>([]);
  const [isPreviousLoading, setIsPreviousLoading] = useState(false);

  // -----------------------------------------------------------------------
  // Fetch latest batch
  // -----------------------------------------------------------------------

  const fetchLatest = useCallback(() => {
    setIsLoading(true);
    setError(null);

    fetch("/api/dashboard?action=insights_latest")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => {
        const batch = (result.data as { batch: InsightBatch | null }).batch;
        setLatestBatch(batch);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load insights")
      )
      .finally(() => setIsLoading(false));
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchLatest();
  }, [fetchLatest]);

  // -----------------------------------------------------------------------
  // Refresh (POST → re-fetch)
  // -----------------------------------------------------------------------

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    setError(null);

    fetch("/api/dashboard/insights", { method: "POST" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => {
        // The POST returns { insights: DashboardInsight[] }
        const insights = result.insights as DashboardInsight[];
        if (insights.length > 0) {
          setLatestBatch({
            batchId: insights[0].batchId,
            generatedAt: insights[0].generatedAt,
            insights,
          });
        }
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to generate insights"
        )
      )
      .finally(() => setIsRefreshing(false));
  }, []);

  // -----------------------------------------------------------------------
  // Load previous batches (lazy)
  // -----------------------------------------------------------------------

  const loadPrevious = useCallback(() => {
    setIsPreviousLoading(true);

    fetch("/api/dashboard?action=insights_history")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => {
        const batches = (result.data as { batches: InsightBatch[] }).batches;
        setPreviousBatches(batches ?? []);
      })
      .catch(() => {
        // Silently fail — previous insights are secondary
        setPreviousBatches([]);
      })
      .finally(() => setIsPreviousLoading(false));
  }, []);

  return {
    latestBatch,
    isLoading,
    error,
    refresh,
    isRefreshing,
    previousBatches,
    loadPrevious,
    isPreviousLoading,
  };
}
