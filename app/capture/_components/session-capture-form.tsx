"use client"

import { useState, useCallback } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2, Sparkles, RefreshCw, Eye } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MAX_COMBINED_CHARS } from "@/lib/constants"
import { useAuth } from "@/components/providers/auth-provider"
import {
  ClientCombobox,
  type ClientSelection,
} from "./client-combobox"
import { DatePicker } from "./date-picker"
import { type ParsedAttachment } from "./file-upload-zone"
import { type SessionRow } from "./expanded-session-row"
import { composeAIInput } from "@/lib/utils/compose-ai-input"
import {
  uploadAttachmentsToSession,
  type PendingAttachmentUpload,
} from "@/lib/utils/upload-attachments"
import { useSignalExtraction } from "@/lib/hooks/use-signal-extraction"
import { useVideoItemsState } from "@/lib/hooks/use-video-items-state"
import { ReextractConfirmDialog } from "@/components/capture/reextract-confirm-dialog"
import { CaptureAttachmentSection } from "./capture-attachment-section"
import { ProcessingVideoBanner } from "./processing-video-banner"
import { StructuredNotesPanel } from "./structured-notes-panel"
import { ViewPromptDialog } from "./view-prompt-dialog"

function getToday(): string {
  return new Date().toISOString().split("T")[0]
}

/**
 * Zod schema for the capture form.
 * The `client` field is an object — we validate that a name exists.
 * react-hook-form + zodResolver handles the rest.
 */
const captureFormSchema = z.object({
  client: z
    .object({
      id: z.string().nullable(),
      name: z.string().min(1, "Client is required"),
    })
    .nullable()
    .refine((val) => val !== null && val.name.trim().length > 0, {
      message: "Client is required",
    }),
  sessionDate: z.string().min(1, "Session date is required"),
  rawNotes: z.string().max(MAX_COMBINED_CHARS, `Notes must be ${MAX_COMBINED_CHARS.toLocaleString()} characters or fewer`),
})

type CaptureFormValues = z.infer<typeof captureFormSchema>

export interface SessionCaptureFormProps {
  onSessionSaved?: (row: SessionRow) => void
}

export function SessionCaptureForm({ onSessionSaved }: SessionCaptureFormProps) {
  const { user } = useAuth()
  const {
    control,
    register,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { isSubmitting, errors },
  } = useForm<CaptureFormValues>({
    resolver: zodResolver(captureFormSchema),
    defaultValues: {
      client: null,
      sessionDate: getToday(),
      rawNotes: "",
    },
    mode: "onSubmit",
  })

  // File attachments — managed outside react-hook-form
  const [attachments, setAttachments] = useState<ParsedAttachment[]>([])

  // Video attachments — PRD-032 Part 1. Transcripts are not yet persisted
  // on save (Part 2 work); the hook's reset() runs after a successful save.
  const {
    videoItems,
    anyVideoInFlight,
    completedTranscripts,
    transcriptChars,
    handleVideoSelected,
    handleVideoCompleted,
    handleTranscriptEdited,
    handleVideoError,
    handleVideoRemove,
    reset: resetVideoItems,
  } = useVideoItemsState({ logPrefix: "[SessionCaptureForm]" })

  // View Prompt dialog state (P2.R1)
  const [showPromptDialog, setShowPromptDialog] = useState(false)

  // Inline error for missing input (notes or attachments)
  const [inputError, setInputError] = useState<string | null>(null)

  const rawNotes = watch("rawNotes")
  const hasNotes = rawNotes?.trim().length > 0
  const hasInput = hasNotes || attachments.length > 0 || completedTranscripts.length > 0

  const attachmentChars = attachments.reduce(
    (sum, a) => sum + a.parsed_content.length, 0
  )
  const totalChars = (rawNotes?.length ?? 0) + attachmentChars + transcriptChars
  const isOverLimit = totalChars > MAX_COMBINED_CHARS

  const getExtractionInput = useCallback(
    () =>
      composeAIInput(getValues("rawNotes"), [
        ...attachments,
        ...completedTranscripts,
      ]),
    [getValues, attachments, completedTranscripts]
  )

  const {
    extractionState,
    structuredNotes,
    promptVersionId,
    structuredJson,
    showReextractConfirm,
    setStructuredNotes,
    handleExtractSignals,
    handleConfirmReextract,
    dismissReextractConfirm,
    resetExtraction,
  } = useSignalExtraction({ getInput: getExtractionInput })

  const handleAddAttachment = (attachment: ParsedAttachment) => {
    setAttachments((prev) => [...prev, attachment])
    setInputError(null)
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  // Video select also clears the missing-input error so the toast doesn't
  // linger after a video is added.
  const onVideoSelected = useCallback(
    (file: File) => {
      handleVideoSelected(file)
      setInputError(null)
    },
    [handleVideoSelected]
  )

  const onSubmit = async (data: CaptureFormValues) => {
    if (!hasInput) {
      setInputError("Provide notes or attach files before saving.")
      return
    }
    if (isOverLimit) {
      toast.error(`Combined input exceeds ${MAX_COMBINED_CHARS.toLocaleString()} characters.`)
      return
    }
    if (anyVideoInFlight) {
      toast.error("A video is still processing — please wait or cancel it before saving.")
      return
    }
    setInputError(null)

    const client = data.client as ClientSelection

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          clientName: client.name,
          sessionDate: data.sessionDate,
          rawNotes: data.rawNotes,
          structuredJson: structuredJson,
          hasAttachments: attachments.length > 0 || completedTranscripts.length > 0,
          promptVersionId: promptVersionId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const message = errorData?.message ?? "Failed to save session"

        if (response.status === 409) {
          toast.error(`Client "${client.name}" already exists. Please select it from the list.`)
        } else {
          toast.error(message)
        }
        return
      }

      const { session } = await response.json()

      const pendingUploads: PendingAttachmentUpload[] = [
        ...attachments.map<PendingAttachmentUpload>((a) => ({
          kind: "parsed",
          file: a.file,
          file_name: a.file_name,
          parsed_content: a.parsed_content,
          source_format: a.source_format,
        })),
        ...completedTranscripts.map<PendingAttachmentUpload>((t) => ({
          kind: "video_transcript",
          file_name: t.file_name,
          file_type: t.file_type,
          file_size: t.file_size,
          duration_seconds: t.duration_seconds,
          parsed_content: t.parsed_content,
          is_edited: t.is_edited === true,
        })),
      ]

      if (pendingUploads.length > 0) {
        await uploadAttachmentsToSession(session.id, pendingUploads)
      }

      const newRow: SessionRow = {
        id: session.id,
        client_id: session.client_id,
        client_name: client.name,
        session_date: session.session_date,
        raw_notes: session.raw_notes,
        structured_notes: session.structured_notes,
        structured_json: session.structured_json,
        created_by: session.created_by,
        created_at: session.created_at,
        created_by_email: user?.email,
        attachment_count: pendingUploads.length,
        prompt_version_id: session.prompt_version_id,
        extraction_stale: session.extraction_stale,
        structured_notes_edited: session.structured_notes_edited,
        updated_by: session.updated_by,
      }

      toast.success("Session saved")
      reset({
        client: null,
        sessionDate: getToday(),
        rawNotes: "",
      })
      resetExtraction()
      setAttachments([])
      resetVideoItems()
      onSessionSaved?.(newRow)
    } catch (err) {
      console.error(
        "[SessionCaptureForm] submit error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to save session — please try again")
    }
  }

  return (
    <div className="w-full max-w-4xl rounded-lg border border-border bg-card p-6">
      <h2 className="mb-2 text-lg font-semibold text-foreground">
        New Session
      </h2>

      <div className="mb-4">
        <ProcessingVideoBanner active={anyVideoInFlight} />
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
        {/* Client field */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="client">Client</Label>
          <Controller
            name="client"
            control={control}
            render={({ field }) => (
              <ClientCombobox
                value={field.value as ClientSelection | null}
                onChange={field.onChange}
              />
            )}
          />
          {errors.client && (
            <p className="text-sm text-destructive">{errors.client.message}</p>
          )}
        </div>

        {/* Session Date field */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="sessionDate">Session Date</Label>
          <Controller
            name="sessionDate"
            control={control}
            render={({ field }) => (
              <DatePicker
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          {errors.sessionDate && (
            <p className="text-sm text-destructive">{errors.sessionDate.message}</p>
          )}
        </div>

        {/* Notes field */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="rawNotes">Notes</Label>
          <Textarea
            id="rawNotes"
            placeholder="Paste or type your session notes here..."
            rows={6}
            className="resize-y"
            {...register("rawNotes")}
          />
          {errors.rawNotes && (
            <p className="text-sm text-destructive">{errors.rawNotes.message}</p>
          )}
          {inputError && (
            <p className="text-sm text-destructive">{inputError}</p>
          )}
        </div>

        <CaptureAttachmentSection
          attachments={attachments}
          videoItems={videoItems}
          onFileParsed={handleAddAttachment}
          onVideoSelected={onVideoSelected}
          onRemove={handleRemoveAttachment}
          onVideoCompleted={handleVideoCompleted}
          onVideoEdited={handleTranscriptEdited}
          onVideoError={handleVideoError}
          onVideoRemove={handleVideoRemove}
          disabled={extractionState === "extracting" || isSubmitting}
          totalChars={totalChars}
          isOverLimit={isOverLimit}
        />

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ai"
            size="lg"
            disabled={!hasInput || isOverLimit || extractionState === "extracting" || anyVideoInFlight}
            onClick={handleExtractSignals}
          >
            {extractionState === "extracting" ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Extracting...
              </>
            ) : extractionState === "done" ? (
              <>
                <RefreshCw className="mr-2 size-4" />
                Re-extract Signals
              </>
            ) : (
              <>
                <Sparkles className="mr-2 size-4" />
                Extract Signals
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="ai-outline"
            size="lg"
            onClick={() => setShowPromptDialog(true)}
          >
            <Eye className="mr-2 size-4" />
            View Prompt
          </Button>

          <Button
            type="submit"
            disabled={isSubmitting || anyVideoInFlight}
            size="lg"
          >
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isSubmitting ? "Saving..." : "Save Session"}
          </Button>
        </div>
      </form>

      {extractionState === "done" && (
        <StructuredNotesPanel
          structuredNotes={structuredNotes}
          structuredJson={structuredJson}
          onChange={setStructuredNotes}
        />
      )}

      <ReextractConfirmDialog
        show={showReextractConfirm}
        onConfirm={handleConfirmReextract}
        onCancel={dismissReextractConfirm}
      />

      <ViewPromptDialog
        open={showPromptDialog}
        onOpenChange={setShowPromptDialog}
        showEditLink
      />
    </div>
  )
}
