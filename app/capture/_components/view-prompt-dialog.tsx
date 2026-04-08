"use client"

import { useState, useEffect } from "react"
import { Eye, ExternalLink, Loader2, AlertCircle } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ViewPromptDialogProps {
  /** Controls dialog visibility. */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Dialog title. Default: "Active Extraction Prompt". */
  title?: string
  /** Optional subtitle / description. */
  description?: string
  /**
   * If provided, the dialog renders this content directly (no fetch).
   * Used by Part 3 to pass a specific prompt version's content.
   */
  content?: string | null
  /** If true, shows the "Edit in Settings" link in the footer (P2.R3). */
  showEditLink?: boolean
  className?: string
}

type FetchState = "idle" | "loading" | "success" | "error"

export function ViewPromptDialog({
  open,
  onOpenChange,
  title = "Active Extraction Prompt",
  description,
  content: externalContent,
  showEditLink = false,
}: ViewPromptDialogProps) {
  const [fetchState, setFetchState] = useState<FetchState>("idle")
  const [promptContent, setPromptContent] = useState<string | null>(null)

  // Fetch prompt when dialog opens and no external content is provided (P2.R4)
  useEffect(() => {
    if (!open) {
      // Reset on close
      setFetchState("idle")
      setPromptContent(null)
      return
    }

    if (externalContent !== undefined) {
      // External content provided — skip fetch
      setPromptContent(externalContent)
      setFetchState(externalContent ? "success" : "error")
      return
    }

    // Fetch the active prompt
    let cancelled = false
    setFetchState("loading")

    fetch("/api/prompts?key=signal_extraction")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch prompt")
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        const content = data.active?.content ?? null
        setPromptContent(content)
        setFetchState(content ? "success" : "error")
      })
      .catch(() => {
        if (cancelled) return
        setFetchState("error")
      })

    return () => { cancelled = true }
  }, [open, externalContent])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] flex flex-col">
        <DialogHeader className="-mx-4 -mt-4 border-b bg-muted/50 p-4 rounded-t-xl">
          <DialogTitle className="flex items-center gap-2">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {fetchState === "loading" && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Loading prompt...
              </span>
            </div>
          )}

          {fetchState === "error" && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                Could not load the extraction prompt. Please try again or
                check Settings.
              </span>
            </div>
          )}

          {fetchState === "success" && promptContent && (
            // <div className="rounded-lg border border-border bg-card p-4">
              <div className="prose prose-sm max-w-none overflow-y-auto prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {promptContent}
                </ReactMarkdown>
              {/* </div> */}
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          {showEditLink ? (
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="size-3.5" />
              Edit in Settings
            </Link>
          ) : (
            <div />
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
