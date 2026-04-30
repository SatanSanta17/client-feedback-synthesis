"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { ThemeCandidateWithThemes } from "@/lib/types/theme-candidate";

import { CandidateList } from "./candidate-list";
import { RefreshButton } from "./refresh-button";

const PAGE_SIZE = 20;

/**
 * Stale-on-mount auto-refresh threshold (Decision 20). The page considers
 * the persisted candidate set stale when its `lastRefreshedAt` is null or
 * older than this window. The first admin to visit per workspace per day
 * pays the recompute cost; subsequent visits within the window read the
 * snapshot directly. Promote to env var if telemetry shows a different
 * cadence is needed.
 */
const STALE_THRESHOLD_HOURS = 24;

interface ListResponse {
  candidates: ThemeCandidateWithThemes[];
  hasMore: boolean;
  lastRefreshedAt: string | null;
}

export function ThemesPageContent() {
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Auto-refresh runs at most once per page mount — even if the user
  // dismisses pairs and re-fetches, the staleness check should not retrigger.
  const autoRefreshFiredRef = useRef(false);

  const fetchList = useCallback(async (currentLimit: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/themes/candidates?limit=${currentLimit}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Request failed (${res.status})`);
      }
      const json: ListResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidates");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const triggerRefresh = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      setIsRefreshing(true);
      try {
        const res = await fetch("/api/themes/candidates/refresh", {
          method: "POST",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `Refresh failed (${res.status})`);
        }
        await fetchList(limit);
        if (!opts.silent) toast.success("Candidates refreshed");
      } catch (err) {
        const message = err instanceof Error ? err.message : "Refresh failed";
        toast.error(message);
      } finally {
        setIsRefreshing(false);
      }
    },
    [fetchList, limit]
  );

  // Initial fetch + re-fetch when the user expands the list via "Show more".
  useEffect(() => {
    fetchList(limit);
  }, [fetchList, limit]);

  // Stale-on-mount auto-refresh (Decision 20).
  useEffect(() => {
    if (autoRefreshFiredRef.current) return;
    if (!data) return;
    if (!isStale(data.lastRefreshedAt)) return;

    autoRefreshFiredRef.current = true;
    triggerRefresh({ silent: true });
  }, [data, triggerRefresh]);

  const handleManualRefresh = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  const handleShowMore = useCallback(() => {
    setLimit((current) => current + PAGE_SIZE);
  }, []);

  const handleCandidateDismissed = useCallback(() => {
    fetchList(limit);
  }, [fetchList, limit]);

  return (
    <section className="mt-8 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Merge candidates
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Theme pairs that look like duplicates, ranked by similarity, signal
            volume, and recency. Dismiss the ones that aren&rsquo;t real
            duplicates.
          </p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            {formatLastRefreshed(data?.lastRefreshedAt ?? null)}
          </p>
        </div>
        <RefreshButton
          onClick={handleManualRefresh}
          isRefreshing={isRefreshing}
          disabled={isLoading}
        />
      </header>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      {!error && isLoading && !data && (
        <p className="text-sm text-[var(--text-secondary)]">Loading candidates…</p>
      )}

      {!error && data && data.candidates.length === 0 && !isRefreshing && (
        <p className="text-sm text-[var(--text-secondary)]">
          No merge candidates right now. Refresh to recompute, or come back as
          your taxonomy grows.
        </p>
      )}

      {!error && data && data.candidates.length > 0 && (
        <CandidateList
          candidates={data.candidates}
          hasMore={data.hasMore}
          onShowMore={handleShowMore}
          onCandidateDismissed={handleCandidateDismissed}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isStale(lastRefreshedAt: string | null): boolean {
  if (!lastRefreshedAt) return true;
  const ts = new Date(lastRefreshedAt).getTime();
  if (isNaN(ts)) return true;
  const ageHours = (Date.now() - ts) / (1000 * 60 * 60);
  return ageHours >= STALE_THRESHOLD_HOURS;
}

function formatLastRefreshed(lastRefreshedAt: string | null): string {
  if (!lastRefreshedAt) return "Not yet refreshed.";
  const date = new Date(lastRefreshedAt);
  if (isNaN(date.getTime())) return "Not yet refreshed.";
  return `Last refreshed ${date.toLocaleString()}`;
}
