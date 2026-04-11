"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// ---------------------------------------------------------------------------
// Shared hook: fetches a dashboard action and re-fetches on filter changes.
// Eliminates duplicated fetch logic across all widget components.
// ---------------------------------------------------------------------------

interface UseDashboardFetchOptions {
  action: string;
  /** Extra query params to merge (e.g. granularity for session volume). */
  extraParams?: Record<string, string>;
}

interface UseDashboardFetchResult<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDashboardFetch<T>(
  options: UseDashboardFetchOptions
): UseDashboardFetchResult<T> {
  const { action, extraParams } = options;
  const searchParams = useSearchParams();

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable serialisation of extraParams for dependency tracking
  const extraKey = extraParams ? JSON.stringify(extraParams) : "";

  const fetchData = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("action", action);

    // Merge extra params
    if (extraParams) {
      for (const [key, value] of Object.entries(extraParams)) {
        if (value) params.set(key, value);
      }
    }

    setIsLoading(true);
    setError(null);

    fetch(`/api/dashboard?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => setData(result.data as T))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Something went wrong")
      )
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, searchParams, extraKey]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}
