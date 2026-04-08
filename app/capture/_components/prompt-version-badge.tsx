"use client"

import { useState, useCallback } from "react"
import { Loader2 } from "lucide-react"
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

  const handleClick = useCallback(async () => {
    if (fetchState === "loading") return

    // If already fetched, just re-open the dialog
    if (fetchState === "success" && promptContent) {
      setShowDialog(true)
      return
    }

    setFetchState("loading")

    try {
      const res = await fetch(`/api/prompts/${promptVersionId}`)
      if (!res.ok) throw new Error("Failed to fetch prompt version")

      const data = await res.json()
      setPromptContent(data.version.content)
      setDialogTitle(
        data.versionNumber
          ? `Extraction Prompt — Version ${data.versionNumber}`
          : "Extraction Prompt Used"
      )
      setFetchState("success")
      setShowDialog(true)
    } catch {
      setFetchState("error")
      toast.error("Could not load prompt version")
    }
  }, [promptVersionId, fetchState, promptContent])

  return (
    <>
      <Badge
        variant="outline"
        className="cursor-pointer text-[10px] px-1.5 py-0 text-muted-foreground hover:text-foreground transition-colors"
        onClick={handleClick}
      >
        {fetchState === "loading" ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          "View prompt used"
        )}
      </Badge>

      <ViewPromptDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        title={dialogTitle}
        content={promptContent}
      />
    </>
  )
}
