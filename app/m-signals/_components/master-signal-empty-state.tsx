"use client"

import { Loader2, FileText, Sparkles } from "lucide-react"

import type { MasterSignal, PageState } from "./use-master-signal"

interface MasterSignalEmptyStateProps {
  pageState: PageState
  isGenerating: boolean
  masterSignal: MasterSignal | null
  staleCount: number
}

export function MasterSignalEmptyState({
  pageState,
  isGenerating,
  masterSignal,
  staleCount,
}: MasterSignalEmptyStateProps) {
  if (pageState === "loading") {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (pageState === "empty-no-sessions") {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-24 text-center">
        <FileText className="mb-3 size-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-muted-foreground">
          No extracted signals found
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground/80">
          Extract signals from individual sessions on the Capture page first.
          Once sessions have extracted signals, you can generate the master
          signal here.
        </p>
      </div>
    )
  }

  if (pageState === "empty-ready" && !isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-24 text-center">
        <Sparkles className="mb-3 size-10 text-muted-foreground/50" />
        <p className="text-sm font-medium text-muted-foreground">
          Ready to generate
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground/80">
          {staleCount} session{staleCount === 1 ? "" : "s"} with extracted
          signals ready to synthesise. Click &ldquo;Generate Master
          Signal&rdquo; above to get started.
        </p>
      </div>
    )
  }

  if (isGenerating && !masterSignal) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-24 text-center">
        <Loader2 className="mb-3 size-8 animate-spin text-muted-foreground" />
        <p className="text-sm font-medium text-muted-foreground">
          Generating master signal...
        </p>
        <p className="mt-1 text-xs text-muted-foreground/80">
          Claude is synthesising signals across all sessions. This may take a
          moment.
        </p>
      </div>
    )
  }

  return null
}
