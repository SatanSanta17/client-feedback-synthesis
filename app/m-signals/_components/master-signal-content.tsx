"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import type { MasterSignal } from "./use-master-signal"

interface MasterSignalContentProps {
  masterSignal: MasterSignal
}

export function MasterSignalContent({ masterSignal }: MasterSignalContentProps) {
  return (
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
  )
}
