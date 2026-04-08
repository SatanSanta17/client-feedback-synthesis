"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"

export type ExtractionState = "idle" | "extracting" | "done"

interface UseSignalExtractionOptions {
  /** Returns the composed AI input string for extraction. */
  getInput: () => string
  /** Pre-populate with existing structured notes (e.g. when editing a saved session). */
  initialStructuredNotes?: string | null
}

interface UseSignalExtractionReturn {
  extractionState: ExtractionState
  structuredNotes: string | null
  lastExtractedNotes: string | null
  /** The prompt version ID returned by the most recent extraction. */
  promptVersionId: string | null
  showReextractConfirm: boolean
  isStructuredDirty: boolean
  setStructuredNotes: (notes: string | null) => void
  handleExtractSignals: () => Promise<void>
  handleConfirmReextract: () => Promise<void>
  dismissReextractConfirm: () => void
  /** Reset all extraction state back to idle with no notes. */
  resetExtraction: () => void
}

export function useSignalExtraction({
  getInput,
  initialStructuredNotes = null,
}: UseSignalExtractionOptions): UseSignalExtractionReturn {
  const [structuredNotes, setStructuredNotes] = useState<string | null>(
    initialStructuredNotes
  )
  const [lastExtractedNotes, setLastExtractedNotes] = useState<string | null>(
    initialStructuredNotes
  )
  const [extractionState, setExtractionState] = useState<ExtractionState>(
    initialStructuredNotes ? "done" : "idle"
  )
  const [promptVersionId, setPromptVersionId] = useState<string | null>(null)
  const [showReextractConfirm, setShowReextractConfirm] = useState(false)

  const isStructuredDirty = structuredNotes !== lastExtractedNotes

  const performExtraction = useCallback(async () => {
    setExtractionState("extracting")

    try {
      const response = await fetch("/api/ai/extract-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNotes: getInput() }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const msg = errorData?.message ?? "Failed to extract signals"
        response.status === 402 ? toast.warning(msg) : toast.error(msg)
        setExtractionState((prev) =>
          prev === "extracting" && structuredNotes ? "done" : "idle"
        )
        return
      }

      const data = await response.json()
      setStructuredNotes(data.structuredNotes)
      setLastExtractedNotes(data.structuredNotes)
      setPromptVersionId(data.promptVersionId ?? null)
      setExtractionState("done")
      toast.success("Signals extracted")
    } catch (err) {
      console.error(
        "[useSignalExtraction] extraction error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to extract signals — please try again")
      setExtractionState((prev) =>
        prev === "extracting" && structuredNotes ? "done" : "idle"
      )
    }
  }, [getInput, structuredNotes])

  const handleExtractSignals = useCallback(async () => {
    if (extractionState === "done" && isStructuredDirty) {
      setShowReextractConfirm(true)
      return
    }
    await performExtraction()
  }, [extractionState, isStructuredDirty, performExtraction])

  const handleConfirmReextract = useCallback(async () => {
    setShowReextractConfirm(false)
    await performExtraction()
  }, [performExtraction])

  const dismissReextractConfirm = useCallback(() => {
    setShowReextractConfirm(false)
  }, [])

  const resetExtraction = useCallback(() => {
    setStructuredNotes(null)
    setLastExtractedNotes(null)
    setPromptVersionId(null)
    setExtractionState("idle")
    setShowReextractConfirm(false)
  }, [])

  return {
    extractionState,
    structuredNotes,
    lastExtractedNotes,
    promptVersionId,
    showReextractConfirm,
    isStructuredDirty,
    setStructuredNotes,
    handleExtractSignals,
    handleConfirmReextract,
    dismissReextractConfirm,
    resetExtraction,
  }
}
