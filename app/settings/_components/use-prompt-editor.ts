"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import { toast } from "sonner"

import { SIGNAL_EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts/signal-extraction"
import {
  MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
} from "@/lib/prompts/master-signal-synthesis"
import type { PromptKey, PromptVersion } from "@/lib/services/prompt-service"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_PROMPTS: Record<PromptKey, string> = {
  signal_extraction: SIGNAL_EXTRACTION_SYSTEM_PROMPT,
  master_signal_cold_start: MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  master_signal_incremental: MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

interface UsePromptEditorReturn {
  activeTab: PromptKey
  effectiveKey: PromptKey
  autoSelectedMasterKey: PromptKey
  displayedMasterKey: PromptKey
  promptTabs: { key: PromptKey; label: string }[]
  currentContent: string
  isDirty: boolean
  isLoading: boolean
  isSaving: boolean
  isReverting: boolean
  history: PromptVersion[]
  isHistoryOpen: boolean
  pendingTab: PromptKey | null
  isViewingAlternate: boolean
  viewingVersion: PromptVersion | null
  viewingVersionNumber: number
  setCurrentContent: (content: string) => void
  setIsHistoryOpen: (open: boolean) => void
  setViewingVersion: (version: PromptVersion | null) => void
  setViewingVersionNumber: (n: number) => void
  handleTabChange: (value: string) => void
  handleTogglePromptVariant: () => void
  handleSave: () => Promise<void>
  handleReset: () => Promise<void>
  handleRevert: (version: PromptVersion) => Promise<void>
  handleDiscardAndSwitch: () => void
  handleCancelSwitch: () => void
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePromptEditor(): UsePromptEditorReturn {
  const [activeTab, setActiveTab] = useState<PromptKey>("signal_extraction")
  const [originalContent, setOriginalContent] = useState("")
  const [currentContent, setCurrentContent] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [pendingTab, setPendingTab] = useState<PromptKey | null>(null)
  const [history, setHistory] = useState<PromptVersion[]>([])
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isReverting, setIsReverting] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<PromptVersion | null>(null)
  const [viewingVersionNumber, setViewingVersionNumber] = useState(0)
  const [hasMasterSignal, setHasMasterSignal] = useState(false)
  const [isMasterSignalTainted, setIsMasterSignalTainted] = useState(false)
  const [isViewingAlternate, setIsViewingAlternate] = useState(false)

  const isDirty = originalContent !== currentContent
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  // -------------------------------------------------------------------------
  // Determine which master signal prompt to show
  // -------------------------------------------------------------------------

  const autoSelectedMasterKey: PromptKey =
    hasMasterSignal && !isMasterSignalTainted
      ? "master_signal_incremental"
      : "master_signal_cold_start"

  const alternateMasterKey: PromptKey =
    autoSelectedMasterKey === "master_signal_incremental"
      ? "master_signal_cold_start"
      : "master_signal_incremental"

  const displayedMasterKey: PromptKey = isViewingAlternate
    ? alternateMasterKey
    : autoSelectedMasterKey

  const effectiveKey: PromptKey =
    activeTab === autoSelectedMasterKey ? displayedMasterKey : activeTab

  const promptTabs = useMemo<{ key: PromptKey; label: string }[]>(
    () => [
      { key: "signal_extraction", label: "Signal Extraction" },
      { key: autoSelectedMasterKey, label: "Master Signal" },
    ],
    [autoSelectedMasterKey]
  )

  // -------------------------------------------------------------------------
  // Check if a master signal exists (once on mount)
  // -------------------------------------------------------------------------

  useEffect(() => {
    async function checkMasterSignal() {
      try {
        const res = await fetch("/api/master-signal")
        if (res.ok) {
          const data = await res.json()
          setHasMasterSignal(data.masterSignal !== null)
          setIsMasterSignalTainted(data.isTainted ?? false)
        }
      } catch {
        // Silently default to cold start if the check fails
      }
    }
    checkMasterSignal()
  }, [])

  // -------------------------------------------------------------------------
  // Fetch active prompt for current tab
  // -------------------------------------------------------------------------

  const fetchPrompt = useCallback(async (key: PromptKey) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/prompts?key=${key}`)
      if (!res.ok) {
        throw new Error(`Failed to fetch prompt: ${res.status}`)
      }
      const data = await res.json()
      const content = data.active?.content ?? DEFAULT_PROMPTS[key]
      setOriginalContent(content)
      setCurrentContent(content)
      setHistory(data.history ?? [])
    } catch (err) {
      console.error("Failed to fetch prompt:", err)
      toast.error("Failed to load prompt. Using default.")
      const fallback = DEFAULT_PROMPTS[key]
      setOriginalContent(fallback)
      setCurrentContent(fallback)
      setHistory([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrompt(effectiveKey)
  }, [effectiveKey, fetchPrompt])

  // -------------------------------------------------------------------------
  // beforeunload guard
  // -------------------------------------------------------------------------

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        e.preventDefault()
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  // -------------------------------------------------------------------------
  // Tab switch with dirty guard
  // -------------------------------------------------------------------------

  function handleTabChange(value: string) {
    const newTab = value as PromptKey
    if (newTab === activeTab) return

    if (isDirty) {
      setPendingTab(newTab)
    } else {
      setActiveTab(newTab)
      setIsViewingAlternate(false)
    }
  }

  function handleTogglePromptVariant() {
    if (isDirty) {
      setPendingTab(isViewingAlternate ? autoSelectedMasterKey : alternateMasterKey)
    } else {
      setIsViewingAlternate((prev) => !prev)
    }
  }

  function handleDiscardAndSwitch() {
    if (!pendingTab) return

    const isMasterVariantToggle =
      activeTab === autoSelectedMasterKey &&
      (pendingTab === "master_signal_cold_start" ||
        pendingTab === "master_signal_incremental") &&
      pendingTab !== activeTab

    if (isMasterVariantToggle) {
      setIsViewingAlternate((prev) => !prev)
    } else {
      setActiveTab(pendingTab)
      setIsViewingAlternate(false)
    }
    setPendingTab(null)
  }

  function handleCancelSwitch() {
    setPendingTab(null)
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  async function handleSave() {
    setIsSaving(true)
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: effectiveKey,
          content: currentContent,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `Save failed: ${res.status}`)
      }

      toast.success("Prompt saved successfully.")
      await fetchPrompt(effectiveKey)
    } catch (err) {
      console.error("Failed to save prompt:", err)
      toast.error(
        err instanceof Error ? err.message : "Failed to save prompt."
      )
    } finally {
      setIsSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Reset to default
  // -------------------------------------------------------------------------

  async function handleReset() {
    const defaultContent = DEFAULT_PROMPTS[effectiveKey]

    if (currentContent === defaultContent) {
      toast.info("Prompt already matches the default.")
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: effectiveKey,
          content: defaultContent,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `Reset failed: ${res.status}`)
      }

      toast.success("Prompt reset to default.")
      await fetchPrompt(effectiveKey)
    } catch (err) {
      console.error("Failed to reset prompt:", err)
      toast.error(
        err instanceof Error ? err.message : "Failed to reset prompt."
      )
    } finally {
      setIsSaving(false)
    }
  }

  // -------------------------------------------------------------------------
  // Revert to a past version
  // -------------------------------------------------------------------------

  async function handleRevert(version: PromptVersion) {
    setIsReverting(true)
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promptKey: effectiveKey,
          content: version.content,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `Revert failed: ${res.status}`)
      }

      toast.success("Reverted to selected version.")
      await fetchPrompt(effectiveKey)
    } catch (err) {
      console.error("Failed to revert prompt:", err)
      toast.error(
        err instanceof Error ? err.message : "Failed to revert prompt."
      )
    } finally {
      setIsReverting(false)
    }
  }

  return {
    activeTab,
    effectiveKey,
    autoSelectedMasterKey,
    displayedMasterKey,
    promptTabs,
    currentContent,
    isDirty,
    isLoading,
    isSaving,
    isReverting,
    history,
    isHistoryOpen,
    pendingTab,
    isViewingAlternate,
    viewingVersion,
    viewingVersionNumber,
    setCurrentContent,
    setIsHistoryOpen,
    setViewingVersion,
    setViewingVersionNumber,
    handleTabChange,
    handleTogglePromptVariant,
    handleSave,
    handleReset,
    handleRevert,
    handleDiscardAndSwitch,
    handleCancelSwitch,
  }
}
