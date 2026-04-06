"use client"

import { useState, useEffect, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Loader2, Sparkles, RefreshCw, AlertTriangle, FileText, Download, Info } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

interface MasterSignal {
  id: string
  content: string
  generatedAt: string
  sessionsIncluded: number
}

type PageState = "loading" | "empty-no-sessions" | "empty-ready" | "has-signal"

function getActiveTeamId(): string | null {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(/(?:^|;\s*)active_team_id=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : null
}

export function MasterSignalPageContent() {
  const [pageState, setPageState] = useState<PageState>("loading")
  const [masterSignal, setMasterSignal] = useState<MasterSignal | null>(null)
  const [staleCount, setStaleCount] = useState(0)
  const [isTainted, setIsTainted] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isTeamAdmin, setIsTeamAdmin] = useState(true)

  const activeTeamId = getActiveTeamId()
  const isTeamContext = !!activeTeamId
  const canGenerate = !isTeamContext || isTeamAdmin

  useEffect(() => {
    if (!activeTeamId) {
      setIsTeamAdmin(true)
      return
    }
    fetch("/api/teams")
      .then((res) => (res.ok ? res.json() : { teams: [] }))
      .then((data) => {
        const team = (data.teams ?? []).find(
          (t: { id: string }) => t.id === activeTeamId
        )
        setIsTeamAdmin(team?.role === "admin")
      })
      .catch(() => setIsTeamAdmin(false))
  }, [activeTeamId])

  // --- Fetch current master signal on mount ---
  const fetchMasterSignal = useCallback(async () => {
    try {
      const response = await fetch("/api/master-signal")
      if (!response.ok) {
        throw new Error("Failed to fetch master signal")
      }

      const data = await response.json()
      setMasterSignal(data.masterSignal ?? null)
      setStaleCount(data.staleCount ?? 0)
      setIsTainted(data.isTainted ?? false)

      if (data.masterSignal) {
        setPageState("has-signal")
      } else if (data.staleCount > 0) {
        setPageState("empty-ready")
      } else {
        setPageState("empty-no-sessions")
      }
    } catch (err) {
      console.error(
        "[MasterSignalPageContent] fetch error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to load master signal")
      setPageState("empty-no-sessions")
    }
  }, [])

  useEffect(() => {
    fetchMasterSignal()
  }, [fetchMasterSignal])

  // --- Generate / Regenerate ---
  const handleGenerate = useCallback(async () => {
    setIsGenerating(true)
    try {
      const response = await fetch("/api/ai/generate-master-signal", {
        method: "POST",
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const message =
          errorData?.message ?? "Failed to generate master signal"
        response.status === 402 ? toast.warning(message) : toast.error(message)
        return
      }

      const data = await response.json()

      if (data.unchanged) {
        toast.info("Master signal is already up to date — no new sessions to process.")
      } else {
        toast.success("Master signal generated successfully")
      }

      setMasterSignal(data.masterSignal)
      setStaleCount(0)
      setIsTainted(false)
      setPageState("has-signal")
    } catch (err) {
      console.error(
        "[MasterSignalPageContent] generate error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to generate master signal — please try again")
    } finally {
      setIsGenerating(false)
    }
  }, [])

  // --- Download as PDF ---
  const handleDownloadPdf = useCallback(async () => {
    if (!masterSignal) return

    setIsDownloading(true)
    try {
      // Dynamic import to avoid bundling pdf-lib on initial page load
      const { generateMasterSignalPdf } = await import("./master-signal-pdf")
      await generateMasterSignalPdf(
        masterSignal.content,
        masterSignal.generatedAt,
        masterSignal.sessionsIncluded
      )
    } catch (err) {
      console.error(
        "[MasterSignalPageContent] PDF error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to generate PDF — please try again")
    } finally {
      setIsDownloading(false)
    }
  }, [masterSignal])

  // --- Render ---
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
          {/* Download PDF */}
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

          {/* Generate / Regenerate — only for admins in team context */}
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

      {/* Tainted banner — takes priority over staleness */}
      {masterSignal && isTainted && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-light)] px-4 py-3 text-sm text-[var(--status-warning-text)]">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            A session with extracted signals was deleted — regenerate to remove
            its data from the master signal.
            {staleCount > 0 && (
              <>
                {" "}Additionally, <strong>{staleCount}</strong> new/updated
                session{staleCount === 1 ? "" : "s"} since last generation.
              </>
            )}
          </span>
        </div>
      )}

      {/* Standard staleness banner — only when NOT tainted */}
      {masterSignal && !isTainted && staleCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-light)] px-4 py-3 text-sm text-[var(--status-warning-text)]">
          <AlertTriangle className="size-4 shrink-0" />
          <span>
            Master signal may be out of date — <strong>{staleCount}</strong>{" "}
            new/updated session{staleCount === 1 ? "" : "s"} since last
            generation.
          </span>
        </div>
      )}

      {/* Read-only info for non-admin team members */}
      {!canGenerate && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--status-info-border)] bg-[var(--status-info-light)] px-4 py-3 text-sm text-[var(--status-info-text)]">
          <Info className="size-4 shrink-0" />
          <span>Only team admins can generate or regenerate the master signal.</span>
        </div>
      )}

      {/* Content area */}
      {pageState === "loading" && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {pageState === "empty-no-sessions" && (
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
      )}

      {pageState === "empty-ready" && !isGenerating && (
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
      )}

      {/* Generating state (shown during generation for both cold start and empty-ready) */}
      {isGenerating && !masterSignal && (
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
      )}

      {/* Master signal content */}
      {masterSignal && (
        <div className="flex flex-col gap-4">
          {/* Metadata bar */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              Generated:{" "}
              {new Date(masterSignal.generatedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <span className="text-border">|</span>
            <span>
              Based on {masterSignal.sessionsIncluded} session
              {masterSignal.sessionsIncluded === 1 ? "" : "s"}
            </span>
          </div>

          {/* Rendered markdown */}
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="prose prose-sm max-w-none overflow-y-auto prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {masterSignal.content}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
