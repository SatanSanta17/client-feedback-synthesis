"use client"

import { cn } from "@/lib/utils"
import { MAX_COMBINED_CHARS } from "@/lib/constants"
import { Label } from "@/components/ui/label"
import { FileUploadZone, type ParsedAttachment } from "./file-upload-zone"
import { AttachmentList } from "./attachment-list"

interface CaptureAttachmentSectionProps {
  attachments: ParsedAttachment[]
  onFileParsed: (attachment: ParsedAttachment) => void
  onRemove: (index: number) => void
  disabled: boolean
  totalChars: number
  isOverLimit: boolean
}

export function CaptureAttachmentSection({
  attachments,
  onFileParsed,
  onRemove,
  disabled,
  totalChars,
  isOverLimit,
}: CaptureAttachmentSectionProps) {
  return (
    <>
      {/* Attachments */}
      <div className="flex flex-col gap-2">
        <Label>Attachments</Label>
        <FileUploadZone
          onFileParsed={onFileParsed}
          disabled={disabled}
          currentCount={attachments.length}
        />
        <AttachmentList
          attachments={attachments}
          onRemove={onRemove}
        />
      </div>

      {/* Character counter */}
      <div className="flex items-center justify-between text-xs">
        <span
          className={cn(
            "text-muted-foreground",
            isOverLimit && "font-medium text-destructive"
          )}
        >
          {totalChars.toLocaleString()} / {MAX_COMBINED_CHARS.toLocaleString()} characters
        </span>
        {isOverLimit && (
          <span className="text-destructive">
            Over limit — remove content or attachments
          </span>
        )}
      </div>
    </>
  )
}
