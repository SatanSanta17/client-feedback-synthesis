"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"

import { useAuth } from "@/components/providers/auth-provider"

interface MasterSignal {
  id: string
  content: string
  generatedAt: string
  sessionsIncluded: number
}

type PageState = "loading" | "empty-no-sessions" | "empty-ready" | "has-signal"

export type { MasterSignal, PageState }

interface UseMasterSignalReturn {
  pageState: PageState
  masterSignal: MasterSignal | null
  staleCount: number
  isTainted: boolean
  isGenerating: boolean
  isDownloading: boolean
  isTeamAdmin: boolean
  canGenerate: boolean
  handleGenerate: () => Promise<void>
  handleDownloadPdf: () => Promise<void>
}

export function useMasterSignal(): UseMasterSignalReturn {
  const { activeTeamId } = useAuth()
  const [pageState, setPageState] = useState<PageState>("loading")
  const [masterSignal, setMasterSignal] = useState<MasterSignal | null>(null)
  const [staleCount, setStaleCount] = useState(0)
  const [isTainted, setIsTainted] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isTeamAdmin, setIsTeamAdmin] = useState(true)

  const isTeamContext = !!activeTeamId
  const canGenerate = !isTeamContext || isTeamAdmin

  // Check team admin status
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

  // Fetch current master signal on mount
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
        "[useMasterSignal] fetch error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to load master signal")
      setPageState("empty-no-sessions")
    }
  }, [])

  useEffect(() => {
    fetchMasterSignal()
  }, [fetchMasterSignal, activeTeamId])

  // Generate / Regenerate
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
        "[useMasterSignal] generate error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to generate master signal — please try again")
    } finally {
      setIsGenerating(false)
    }
  }, [])

  // Download as PDF
  const handleDownloadPdf = useCallback(async () => {
    if (!masterSignal) return

    setIsDownloading(true)
    try {
      const { generateMasterSignalPdf } = await import("./master-signal-pdf")
      await generateMasterSignalPdf(
        masterSignal.content,
        masterSignal.generatedAt,
        masterSignal.sessionsIncluded
      )
    } catch (err) {
      console.error(
        "[useMasterSignal] PDF error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to generate PDF — please try again")
    } finally {
      setIsDownloading(false)
    }
  }, [masterSignal])

  return {
    pageState,
    masterSignal,
    staleCount,
    isTainted,
    isGenerating,
    isDownloading,
    isTeamAdmin,
    canGenerate,
    handleGenerate,
    handleDownloadPdf,
  }
}
