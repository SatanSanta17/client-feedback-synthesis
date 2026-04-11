"use client";

import { AlertCircle, RefreshCw, Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CardState = "loading" | "error" | "empty" | "content";

interface DashboardCardProps {
  title: string;
  isLoading: boolean;
  error: string | null;
  isEmpty?: boolean;
  emptyMessage?: string;
  onRetry?: () => void;
  className?: string;
  children: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-1">
      <div className="h-4 w-2/3 animate-pulse rounded bg-[var(--surface-raised)]" />
      <div className="flex-1 animate-pulse rounded bg-[var(--surface-raised)]" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-[var(--surface-raised)]" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <AlertCircle className="size-8 text-[var(--status-error)]" />
      <p className="text-sm text-[var(--text-secondary)]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-light)]"
        >
          <RefreshCw className="size-3.5" />
          Retry
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  message: string;
}

function EmptyState({ message }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <Inbox className="size-8 text-[var(--text-tertiary)]" />
      <p className="text-sm text-[var(--text-secondary)]">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DashboardCard
// ---------------------------------------------------------------------------

export function DashboardCard({
  title,
  isLoading,
  error,
  isEmpty = false,
  emptyMessage = "No data available",
  onRetry,
  className,
  children,
}: DashboardCardProps) {
  const state: CardState = isLoading
    ? "loading"
    : error
      ? "error"
      : isEmpty
        ? "empty"
        : "content";

  return (
    <div
      className={cn(
        "flex min-h-[280px] flex-col rounded-lg border border-[var(--border-default)] bg-[var(--surface-page)] p-4 shadow-sm",
        className
      )}
    >
      {/* Header */}
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-primary)]">
        {title}
      </h3>

      {/* Body — fills remaining space */}
      <div className="flex flex-1 flex-col">
        {state === "loading" && <CardSkeleton />}
        {state === "error" && (
          <ErrorState message={error!} onRetry={onRetry} />
        )}
        {state === "empty" && <EmptyState message={emptyMessage} />}
        {state === "content" && children}
      </div>
    </div>
  );
}
