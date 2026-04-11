"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StructuredSignalView } from "@/components/capture/structured-signal-view";
import type { ExtractedSignals } from "@/lib/schemas/extraction-schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionPreviewDialogProps {
  /** Non-null = open dialog for this session. Null = closed. */
  sessionId: string | null;
  onClose: () => void;
}

interface SessionDetailData {
  sessionId: string;
  sessionDate: string;
  clientName: string;
  structuredJson: ExtractedSignals | null;
}

// ---------------------------------------------------------------------------
// SessionPreviewDialog
// ---------------------------------------------------------------------------

export function SessionPreviewDialog({
  sessionId,
  onClose,
}: SessionPreviewDialogProps) {
  const [data, setData] = useState<SessionDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSession = useCallback(() => {
    if (!sessionId) return;

    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({
      action: "session_detail",
      sessionId,
    });

    fetch(`/api/dashboard?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((result) => setData(result.data as SessionDetailData))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Something went wrong")
      )
      .finally(() => setIsLoading(false));
  }, [sessionId]);

  useEffect(() => {
    if (sessionId) {
      setData(null);
      fetchSession();
    }
  }, [sessionId, fetchSession]);

  return (
    <Dialog
      open={sessionId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data
              ? `${data.clientName} — ${data.sessionDate}`
              : "Session Preview"}
          </DialogTitle>
          <DialogDescription>
            Full structured signal view for this session
          </DialogDescription>
        </DialogHeader>

        {/* Loading */}
        {isLoading && (
          <div className="flex flex-col gap-3 py-6">
            <div className="h-5 w-48 animate-pulse rounded bg-[var(--surface-raised)]" />
            <div className="h-4 w-32 animate-pulse rounded bg-[var(--surface-raised)]" />
            <div className="h-32 animate-pulse rounded bg-[var(--surface-raised)]" />
            <div className="h-20 animate-pulse rounded bg-[var(--surface-raised)]" />
          </div>
        )}

        {/* Error */}
        {!isLoading && error && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <AlertCircle className="size-8 text-[var(--status-error)]" />
            <p className="text-sm text-[var(--text-secondary)]">{error}</p>
            <button
              type="button"
              onClick={fetchSession}
              className="mt-1 flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-[var(--brand-primary)] transition-colors hover:bg-[var(--brand-primary-light)]"
            >
              <RefreshCw className="size-3.5" />
              Retry
            </button>
          </div>
        )}

        {/* Content */}
        {!isLoading && !error && data && data.structuredJson && (
          <StructuredSignalView signals={data.structuredJson} />
        )}

        {/* No structured data */}
        {!isLoading && !error && data && !data.structuredJson && (
          <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              This session has no structured signal data.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
