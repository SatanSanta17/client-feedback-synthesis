"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { ViewPromptDialog } from "./view-prompt-dialog"

interface PromptVersionBadgeProps {
  promptVersionId: string
  className?: string
}

type FetchState = "idle" | "loading" | "success" | "error"

export function PromptVersionBadge({
  promptVersionId,
}: PromptVersionBadgeProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [fetchState, setFetchState] = useState<FetchState>("idle")
  const [promptContent, setPromptContent] = useState<string | null>(null)
  const [dialogTitle, setDialogTitle] = useState("Extraction Prompt Used")

  const handleClick = useCallback(() => {
    // Open the dialog immediately so the loader renders inside it
    setShowDialog(true)

    // Re-open without re-fetching when content is already cached
    if (fetchState === "success" && promptContent) return
    if (fetchState === "loading") return

    setFetchState("loading")

    fetch(`/api/prompts/${promptVersionId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to fetch prompt version")
        const data = await res.json()
        setPromptContent(data.version.content)
        setDialogTitle(
          data.versionNumber
            ? `Extraction Prompt — Version ${data.versionNumber}`
            : "Extraction Prompt Used"
        )
        setFetchState("success")
      })
      .catch(() => {
        setFetchState("error")
        toast.error("Could not load prompt version")
      })
  }, [promptVersionId, fetchState, promptContent])

  return (
    <>
      <Badge
        variant="outline"
        className="cursor-pointer text-[10px] px-1.5 py-0 text-muted-foreground hover:text-foreground transition-colors"
        onClick={handleClick}
      >
        View prompt used
      </Badge>

      <ViewPromptDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        title={dialogTitle}
        content={promptContent}
        isFetching={fetchState === "loading"}
      />
    </>
  )
}
