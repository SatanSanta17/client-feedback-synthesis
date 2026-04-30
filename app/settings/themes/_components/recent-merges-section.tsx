"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils/format-relative-time";
import { pluralize } from "@/lib/utils/plural";
import type { ThemeMerge } from "@/lib/types/theme-merge";

const PAGE_SIZE = 10;

export interface RecentMergesHandle {
  refresh: () => void;
}

interface ListResponse {
  items: ThemeMerge[];
  hasMore: boolean;
}

/**
 * "Recent merges" audit section (PRD-026 P3.R7) — sibling of the candidates
 * list on `/settings/themes`. Self-contained: owns its own fetch + paging.
 *
 * Exposes a `refresh()` imperative handle so the parent can re-fetch this
 * section right after a confirmed merge without prop-drilling refetch
 * triggers through the merge dialog.
 */
export const RecentMergesSection = forwardRef<RecentMergesHandle>(
  function RecentMergesSection(_props, ref) {
    const [data, setData] = useState<ListResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [limit, setLimit] = useState(PAGE_SIZE);

    const fetchList = useCallback(async (currentLimit: number) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/themes/merges?limit=${currentLimit}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message ?? `Request failed (${res.status})`);
        }
        const json: ListResponse = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load merges");
      } finally {
        setIsLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchList(limit);
    }, [fetchList, limit]);

    useImperativeHandle(
      ref,
      () => ({
        refresh: () => fetchList(limit),
      }),
      [fetchList, limit]
    );

    const handleShowMore = useCallback(() => {
      setLimit((current) => current + PAGE_SIZE);
    }, []);

    return (
      <section className="mt-12 space-y-4 border-t border-[var(--border-default)] pt-8">
        <header>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Recent merges
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Audit trail of theme merges in this workspace.
          </p>
        </header>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!error && isLoading && !data && (
          <p className="text-sm text-[var(--text-secondary)]">Loading…</p>
        )}

        {!error && data && data.items.length === 0 && (
          <p className="text-sm text-[var(--text-secondary)]">
            No merges yet. Confirmed merges will appear here.
          </p>
        )}

        {!error && data && data.items.length > 0 && (
          <ul className="space-y-2">
            {data.items.map((merge) => (
              <MergeListItem key={merge.id} merge={merge} />
            ))}
          </ul>
        )}

        {data?.hasMore && (
          <div className="flex justify-center pt-2">
            <Button variant="outline" size="sm" onClick={handleShowMore}>
              Show more
            </Button>
          </div>
        )}
      </section>
    );
  }
);

function MergeListItem({ merge }: { merge: ThemeMerge }) {
  return (
    <li className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-3">
      <p className="text-sm text-[var(--text-primary)]">
        <span className="font-semibold">{merge.archivedThemeName}</span>{" "}
        <span aria-hidden className="text-[var(--text-muted)]">→</span>{" "}
        <span className="font-semibold">{merge.canonicalThemeName}</span>
      </p>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {merge.reassignedCount}{" "}
        {pluralize("signal assignment", merge.reassignedCount)} ·{" "}
        {merge.distinctSessions}{" "}
        {pluralize("session", merge.distinctSessions)} ·{" "}
        {merge.distinctClients}{" "}
        {pluralize("client", merge.distinctClients)} ·{" "}
        {formatRelativeTime(merge.mergedAt)}
      </p>
    </li>
  );
}
