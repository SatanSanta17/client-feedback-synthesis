"use client"

import { Loader2, Sparkles, RefreshCw, Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useMasterSignal } from "./use-master-signal"
import { MasterSignalStatusBanner } from "./master-signal-status-banner"
import { MasterSignalEmptyState } from "./master-signal-empty-state"
import { MasterSignalContent } from "./master-signal-content"

export function MasterSignalPageContent() {
  const {
    pageState,
    masterSignal,
    staleCount,
    isTainted,
    isGenerating,
    isDownloading,
    canGenerate,
    handleGenerate,
    handleDownloadPdf,
  } = useMasterSignal()

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Master Signal
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI-synthesised analysis of all client session signals
          </p>
        </div>

        <div className="flex items-center gap-2">
          {masterSignal && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isDownloading || isGenerating}
            >
              {isDownloading ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 size-4" />
              )}
              {isDownloading ? "Generating PDF..." : "Download PDF"}
            </Button>
          )}

          {canGenerate && (
            <Button
              variant="ai"
              size="sm"
              onClick={handleGenerate}
              disabled={
                isGenerating || pageState === "loading" || pageState === "empty-no-sessions"
              }
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Generating...
                </>
              ) : masterSignal ? (
                <>
                  <RefreshCw className="mr-1.5 size-4" />
                  Re-generate
                </>
              ) : (
                <>
                  <Sparkles className="mr-1.5 size-4" />
                  Generate Master Signal
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Status banners */}
      {masterSignal && isTainted && (
        <MasterSignalStatusBanner variant="tainted" staleCount={staleCount} />
      )}
      {masterSignal && !isTainted && staleCount > 0 && (
        <MasterSignalStatusBanner variant="stale" staleCount={staleCount} />
      )}
      {!canGenerate && (
        <MasterSignalStatusBanner variant="info" />
      )}

      {/* Empty / loading / generating states */}
      <MasterSignalEmptyState
        pageState={pageState}
        isGenerating={isGenerating}
        masterSignal={masterSignal}
        staleCount={staleCount}
      />

      {/* Master signal content */}
      {masterSignal && <MasterSignalContent masterSignal={masterSignal} />}
    </div>
  )
}
