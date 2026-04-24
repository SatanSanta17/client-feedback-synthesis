"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { toast } from "sonner"

import { SIGNAL_EXTRACTION_SYSTEM_PROMPT } from "@/lib/prompts/signal-extraction"
import type { PromptVersion } from "@/lib/services/prompt-service"
import { useAuth } from "@/components/providers/auth-provider"

export function useExtractionPrompt() {
  const effectiveKey = "signal_extraction"
  const defaultContent = SIGNAL_EXTRACTION_SYSTEM_PROMPT
  const { activeTeamId } = useAuth()

  const [originalContent, setOriginalContent] = useState("")
  const [currentContent, setCurrentContent] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [history, setHistory] = useState<PromptVersion[]>([])
  const [isHistoryOpen, setIsHistoryOpen] = useState(false)
  const [isReverting, setIsReverting] = useState(false)
  const [viewingVersion, setViewingVersion] = useState<PromptVersion | null>(null)
  const [viewingVersionNumber, setViewingVersionNumber] = useState(0)

  const isDirty = originalContent !== currentContent
  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty

  const fetchPrompt = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/prompts?key=${effectiveKey}`)
      if (!res.ok) throw new Error(`Failed to fetch prompt: ${res.status}`)
      const data = await res.json()
      const content = data.active?.content ?? defaultContent
      setOriginalContent(content)
      setCurrentContent(content)
      setHistory(data.history ?? [])
    } catch (err) {
      console.error("Failed to fetch prompt:", err)
      toast.error("Failed to load prompt. Using default.")
      setOriginalContent(defaultContent)
      setCurrentContent(defaultContent)
      setHistory([])
    } finally {
      setIsLoading(false)
    }
    // activeTeamId is a dep so switching workspace re-fetches the active prompt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultContent, effectiveKey, activeTeamId])

  useEffect(() => {
    fetchPrompt()
  }, [fetchPrompt])

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [])

  async function handleSave() {
    setIsSaving(true)
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptKey: effectiveKey, content: currentContent }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `Save failed: ${res.status}`)
      }
      toast.success("Prompt saved successfully.")
      await fetchPrompt()
    } catch (err) {
      console.error("Failed to save prompt:", err)
      toast.error(err instanceof Error ? err.message : "Failed to save prompt.")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleReset() {
    if (currentContent === defaultContent) {
      toast.info("Prompt already matches the default.")
      return
    }
    setIsSaving(true)
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptKey: effectiveKey, content: defaultContent }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `Reset failed: ${res.status}`)
      }
      toast.success("Prompt reset to default.")
      await fetchPrompt()
    } catch (err) {
      console.error("Failed to reset prompt:", err)
      toast.error(err instanceof Error ? err.message : "Failed to reset prompt.")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleRevert(version: PromptVersion) {
    setIsReverting(true)
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptKey: effectiveKey, content: version.content }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message ?? `Revert failed: ${res.status}`)
      }
      toast.success("Reverted to selected version.")
      await fetchPrompt()
    } catch (err) {
      console.error("Failed to revert prompt:", err)
      toast.error(err instanceof Error ? err.message : "Failed to revert prompt.")
    } finally {
      setIsReverting(false)
    }
  }

  return {
    currentContent,
    isDirty,
    isLoading,
    isSaving,
    isReverting,
    history,
    isHistoryOpen,
    viewingVersion,
    viewingVersionNumber,
    setCurrentContent,
    setIsHistoryOpen,
    setViewingVersion,
    setViewingVersionNumber,
    handleSave,
    handleReset,
    handleRevert,
  }
}
