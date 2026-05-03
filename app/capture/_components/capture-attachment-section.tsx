"use client"

import { cn } from "@/lib/utils"
import { MAX_COMBINED_CHARS } from "@/lib/constants"
import { Label } from "@/components/ui/label"
import { FileUploadZone, type ParsedAttachment } from "./file-upload-zone"
import { AttachmentList } from "./attachment-list"
import { VideoAttachmentSection } from "./video-attachment-section"
import type {
  VideoListItem,
  VideoTranscriptAttachment,
  VideoUploadError,
} from "@/lib/types/video-attachment"

interface CaptureAttachmentSectionProps {
  attachments: ParsedAttachment[]
  videoItems: VideoListItem[]
  onFileParsed: (attachment: ParsedAttachment) => void
  onVideoSelected: (file: File) => void
  onRemove: (index: number) => void
  onVideoCompleted: (id: string, attachment: VideoTranscriptAttachment) => void
  onVideoEdited: (id: string, parsedContent: string) => void
  onVideoError: (id: string, error: VideoUploadError) => void
  onVideoRemove: (id: string) => void
  disabled: boolean
  totalChars: number
  isOverLimit: boolean
}

export function CaptureAttachmentSection({
  attachments,
  videoItems,
  onFileParsed,
  onVideoSelected,
  onRemove,
  onVideoCompleted,
  onVideoEdited,
  onVideoError,
  onVideoRemove,
  disabled,
  totalChars,
  isOverLimit,
}: CaptureAttachmentSectionProps) {
  const totalAttachmentCount = attachments.length + videoItems.length

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label>Attachments</Label>
        <FileUploadZone
          onFileParsed={onFileParsed}
          onVideoSelected={onVideoSelected}
          disabled={disabled}
          currentCount={totalAttachmentCount}
        />
        <AttachmentList
          attachments={attachments}
          onRemove={onRemove}
        />
        <VideoAttachmentSection
          items={videoItems}
          onCompleted={onVideoCompleted}
          onEdited={onVideoEdited}
          onError={onVideoError}
          onRemove={onVideoRemove}
        />
      </div>

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
