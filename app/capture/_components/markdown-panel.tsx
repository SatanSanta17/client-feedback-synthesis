"use client"

import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Eye, Pencil } from "lucide-react"

import { cn, PROSE_CLASSES } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

export interface MarkdownPanelProps {
  content: string
  onChange?: (value: string) => void
  readOnly?: boolean
  /**
   * When true, renders the textarea editor directly and hides the internal
   * Edit/Preview toggle. For callers that own the edit mode externally.
   * Ignored when `readOnly` is true.
   */
  forceEdit?: boolean
  className?: string
}

export function MarkdownPanel({ content, onChange, readOnly, forceEdit, className }: MarkdownPanelProps) {
  const [isEditing, setIsEditing] = useState(false)

  const showEditor = !readOnly && (forceEdit || isEditing)
  const showToggle = !readOnly && !forceEdit

  return (
    <div className={cn("rounded-lg border border-border bg-card", className)}>
      {showToggle && (
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing((prev) => !prev)}
            className="gap-1.5 text-xs text-muted-foreground"
          >
            {isEditing ? (
              <>
                <Eye className="size-3.5" />
                Preview
              </>
            ) : (
              <>
                <Pencil className="size-3.5" />
                Edit
              </>
            )}
          </Button>
        </div>
      )}

      {/* Content area */}
      <div className="p-4">
        {showEditor ? (
          <Textarea
            value={content}
            onChange={(e) => onChange?.(e.target.value)}
            rows={20}
            className="min-h-[300px] resize-y font-mono text-sm"
          />
        ) : (
          <div className={PROSE_CLASSES}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
