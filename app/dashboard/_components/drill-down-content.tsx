"use client";

import { useState } from "react";
import { AlertCircle, ChevronRight, Eye, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDashboardFetch } from "./use-dashboard-fetch";
import type {
  DrillDownContext,
  DrillDownClientGroup,
  DrillDownResult,
} from "./drill-down-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrillDownContentProps {
  context: DrillDownContext;
  /** Called when the user clicks "View Session" on a signal row. */
  onViewSession: (sessionId: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_TYPE_LABELS: Record<string, string> = {
  pain_point: "Pain Point",
  requirement: "Requirement",
  praise: "Praise",
  question: "Question",
  competitive_mention: "Competitive",
  action_item: "Action Item",
  raw: "Raw",
};

function humanChunkType(key: string): string {
  return CHUNK_TYPE_LABELS[key] ?? key.replace(/_/g, " ");
}

/** Max lines of chunk text before truncation. */
const TRUNCATE_LENGTH = 200;

// ---------------------------------------------------------------------------
// Signal row
// ---------------------------------------------------------------------------

interface SignalRowProps {
  embeddingId: string;
  sessionId: string;
  sessionDate: string;
  chunkText: string;
  chunkType: string;
  themeName: string | null;
  onViewSession: (sessionId: string) => void;
}

function SignalRow({
  sessionId,
  sessionDate,
  chunkText,
  chunkType,
  themeName,
  onViewSession,
}: SignalRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isTruncated = chunkText.length > TRUNCATE_LENGTH;
  const displayText =
    !expanded && isTruncated
      ? chunkText.slice(0, TRUNCATE_LENGTH) + "..."
      : chunkText;

  return (
    <div className="border-b border-[var(--border-default)] py-3 last:border-b-0">
      {/* Badges row */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex rounded-full bg-[var(--brand-primary-light)] px-2 py-0.5 text-xs font-medium text-[var(--brand-primary)]">
          {humanChunkType(chunkType)}
        </span>
        {themeName && (
          <span className="inline-flex rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
            {themeName}
          </span>
        )}
        <span className="ml-auto text-xs text-[var(--text-secondary)]">
          {sessionDate}
        </span>
      </div>

      {/* Chunk text */}
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-primary)]">
        {displayText}
      </p>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs font-medium text-[var(--brand-primary)] hover:underline"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}

      {/* View Session link */}
      <button
        type="button"
        onClick={() => onViewSession(sessionId)}
        className="mt-2 flex items-center gap-1 text-xs font-medium text-[var(--brand-primary)] transition-colors hover:underline"
      >
        <Eye className="size-3.5" />
        View Session
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client accordion group
// ---------------------------------------------------------------------------

interface ClientGroupProps {
  group: DrillDownClientGroup;
  onViewSession: (sessionId: string) => void;
  defaultOpen?: boolean;
}

function ClientGroup({ group, onViewSession, defaultOpen }: ClientGroupProps) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-md border border-[var(--border-default)]"
    >
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-raised)]">
        <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        <span className="flex-1">{group.clientName}</span>
        <span className="rounded-full bg-[var(--surface-raised)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
          {group.signalCount} signal{group.signalCount !== 1 ? "s" : ""}
        </span>
      </summary>
      <div className="px-3 pb-2">
        {group.signals.map((signal) => (
          <SignalRow
            key={signal.embeddingId}
            embeddingId={signal.embeddingId}
            sessionId={signal.sessionId}
            sessionDate={signal.sessionDate}
            chunkText={signal.chunkText}
            chunkType={signal.chunkType}
            themeName={signal.themeName}
            onViewSession={onViewSession}
          />
        ))}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function DrillDownSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="h-5 w-48 animate-pulse rounded bg-[var(--surface-raised)]" />
      <div className="h-4 w-32 animate-pulse rounded bg-[var(--surface-raised)]" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-16 animate-pulse rounded-md bg-[var(--surface-raised)]"
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DrillDownContent
// ---------------------------------------------------------------------------

export function DrillDownContent({
  context,
  onViewSession,
  className,
}: DrillDownContentProps) {
  const { data, isLoading, error, refetch } = useDashboardFetch<DrillDownResult>(
    {
      action: "drill_down",
      extraParams: { drillDown: JSON.stringify(context) },
    }
  );

  // Loading
  if (isLoading) {
    return (
      <div className={cn("flex flex-col", className)}>
        <DrillDownSkeleton />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 text-center",
          className
        )}
      >
        <AlertCircle className="size-8 text-[var(--status-error)]" />
        <p className="text-sm text-[var(--text-secondary)]">{error}</p>
        <button
          type="button"
          onClick={refetch}
          className="mt-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-light)]"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </button>
      </div>
    );
  }

  // Empty
  if (!data || data.totalSignals === 0) {
    return (
      <div
        className={cn(
          "flex flex-1 flex-col items-center justify-center gap-2 text-center",
          className
        )}
      >
        <p className="text-sm text-[var(--text-secondary)]">
          No signals found for this filter.
        </p>
      </div>
    );
  }

  // Content
  const isTruncated = data.totalSignals > data.clients.reduce(
    (sum, c) => sum + c.signalCount,
    0
  );

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Count header */}
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {isTruncated
            ? `Showing ${data.clients.reduce((s, c) => s + c.signalCount, 0)} of ${data.totalSignals} signals`
            : `${data.totalSignals} signal${data.totalSignals !== 1 ? "s" : ""}`}{" "}
          from {data.totalClients} client{data.totalClients !== 1 ? "s" : ""}
        </p>
        <p className="text-xs text-[var(--text-secondary)]">
          {data.filterLabel}
        </p>
      </div>

      {/* Client accordion list */}
      <div className="flex flex-col gap-2">
        {data.clients.map((group, idx) => (
          <ClientGroup
            key={group.clientId}
            group={group}
            onViewSession={onViewSession}
            defaultOpen={idx === 0}
          />
        ))}
      </div>
    </div>
  );
}
