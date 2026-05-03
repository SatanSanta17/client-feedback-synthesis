"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"

export type ExtractionState = "idle" | "extracting" | "done"

interface UseSignalExtractionOptions {
  /** Returns the composed AI input string for extraction. */
  getInput: () => string
  /** Pre-populate with existing structured notes (e.g. when editing a saved session). */
  initialStructuredNotes?: string | null
  /** Pre-populate with existing structured JSON (post-PRD-031 sessions where markdown is null). */
  initialStructuredJson?: Record<string, unknown> | null
  /** When true, always show the re-extract confirmation if structured notes exist (e.g. server-side manual edit flag). */
  forceConfirmOnReextract?: boolean
}

interface UseSignalExtractionReturn {
  extractionState: ExtractionState
  structuredNotes: string | null
  /** The prompt version ID returned by the most recent extraction. */
  promptVersionId: string | null
  /** The structured JSON returned by the most recent extraction (opaque passthrough for persistence). */
  structuredJson: Record<string, unknown> | null
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
  initialStructuredJson = null,
  forceConfirmOnReextract = false,
}: UseSignalExtractionOptions): UseSignalExtractionReturn {
  const [structuredNotes, setStructuredNotesState] = useState<string | null>(
    initialStructuredNotes
  )
  // PRD-031 Part 1: initial extractionState must consider JSON because new
  // sessions have structured_json without legacy markdown.
  const hasInitialExtraction = initialStructuredNotes !== null || initialStructuredJson !== null
  const [extractionState, setExtractionState] = useState<ExtractionState>(
    hasInitialExtraction ? "done" : "idle"
  )
  const [promptVersionId, setPromptVersionId] = useState<string | null>(null)
  const [structuredJson, setStructuredJson] = useState<Record<string, unknown> | null>(
    initialStructuredJson
  )
  const [showReextractConfirm, setShowReextractConfirm] = useState(false)
  // PRD-031 Part 1: extraction no longer returns markdown, so the previous
  // "compare current markdown to last extracted markdown" dirty test is gone.
  // We instead track manual edits explicitly: any external setStructuredNotes
  // call (only reachable via the legacy MarkdownPanel edit toggle) marks dirty;
  // a fresh extraction clears the flag.
  const [manualEditMade, setManualEditMade] = useState(false)

  const isStructuredDirty = manualEditMade

  const setStructuredNotes = useCallback((notes: string | null) => {
    setStructuredNotesState(notes)
    setManualEditMade(true)
  }, [])

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
          prev === "extracting" && (structuredNotes || structuredJson) ? "done" : "idle"
        )
        return
      }

      const data = await response.json()
      // PRD-031 Part 1: extraction returns JSON only — clear any stale markdown
      // so the StructuredSignalView (JSON path) is unambiguously the source of truth.
      setStructuredNotesState(null)
      setPromptVersionId(data.promptVersionId ?? null)
      setStructuredJson(data.structuredJson ?? null)
      setManualEditMade(false)
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
  }, [getInput, structuredNotes, structuredJson])

  const handleExtractSignals = useCallback(async () => {
    if (extractionState === "done" && (isStructuredDirty || forceConfirmOnReextract)) {
      setShowReextractConfirm(true)
      return
    }
    await performExtraction()
  }, [extractionState, isStructuredDirty, forceConfirmOnReextract, performExtraction])

  const handleConfirmReextract = useCallback(async () => {
    setShowReextractConfirm(false)
    await performExtraction()
  }, [performExtraction])

  const dismissReextractConfirm = useCallback(() => {
    setShowReextractConfirm(false)
  }, [])

  const resetExtraction = useCallback(() => {
    setStructuredNotesState(null)
    setPromptVersionId(null)
    setStructuredJson(null)
    setManualEditMade(false)
    setExtractionState("idle")
    setShowReextractConfirm(false)
  }, [])

  return {
    extractionState,
    structuredNotes,
    promptVersionId,
    structuredJson,
    showReextractConfirm,
    isStructuredDirty,
    setStructuredNotes,
    handleExtractSignals,
    handleConfirmReextract,
    dismissReextractConfirm,
    resetExtraction,
  }
}
