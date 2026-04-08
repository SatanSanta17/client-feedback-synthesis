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
import {
  ClientCombobox,
  type ClientSelection,
} from "./client-combobox"
import { DatePicker } from "./date-picker"
import { type ParsedAttachment } from "./file-upload-zone"
import { composeAIInput } from "@/lib/utils/compose-ai-input"
import { uploadAttachmentsToSession } from "@/lib/utils/upload-attachments"
import { useSignalExtraction } from "@/lib/hooks/use-signal-extraction"
import { ReextractConfirmDialog } from "@/components/capture/reextract-confirm-dialog"
import { CaptureAttachmentSection } from "./capture-attachment-section"
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
  onSessionSaved?: () => void
}

export function SessionCaptureForm({ onSessionSaved }: SessionCaptureFormProps) {
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

  // View Prompt dialog state (P2.R1)
  const [showPromptDialog, setShowPromptDialog] = useState(false)

  // Inline error for missing input (notes or attachments)
  const [inputError, setInputError] = useState<string | null>(null)

  // Watch rawNotes to enable/disable the extract button
  const rawNotes = watch("rawNotes")
  const hasNotes = rawNotes?.trim().length > 0
  const hasInput = hasNotes || attachments.length > 0

  // Combined character counter
  const attachmentChars = attachments.reduce(
    (sum, a) => sum + a.parsed_content.length, 0
  )
  const totalChars = (rawNotes?.length ?? 0) + attachmentChars
  const isOverLimit = totalChars > MAX_COMBINED_CHARS

  // Signal extraction via shared hook
  const getExtractionInput = useCallback(
    () => composeAIInput(getValues("rawNotes"), attachments),
    [getValues, attachments]
  )

  const {
    extractionState,
    structuredNotes,
    promptVersionId,
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

  const onSubmit = async (data: CaptureFormValues) => {
    if (!hasInput) {
      setInputError("Provide notes or attach files before saving.")
      return
    }
    if (isOverLimit) {
      toast.error(`Combined input exceeds ${MAX_COMBINED_CHARS.toLocaleString()} characters.`)
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
          structuredNotes: structuredNotes,
          hasAttachments: attachments.length > 0,
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

      if (attachments.length > 0) {
        await uploadAttachmentsToSession(session.id, attachments)
      }

      toast.success("Session saved")
      reset({
        client: null,
        sessionDate: getToday(),
        rawNotes: "",
      })
      resetExtraction()
      setAttachments([])
      onSessionSaved?.()
    } catch (err) {
      console.error(
        "[SessionCaptureForm] submit error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to save session — please try again")
    }
  }

  return (
    <div className="w-full max-w-2xl rounded-lg border border-border bg-card p-6">
      <h2 className="mb-6 text-lg font-semibold text-foreground">
        Capture Session
      </h2>

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
          onFileParsed={handleAddAttachment}
          onRemove={handleRemoveAttachment}
          disabled={extractionState === "extracting" || isSubmitting}
          totalChars={totalChars}
          isOverLimit={isOverLimit}
        />

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {/* Extract Signals button */}
          <Button
            type="button"
            variant="ai"
            size="lg"
            disabled={!hasInput || isOverLimit || extractionState === "extracting"}
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

          {/* View Prompt button — ai-outline, visually subordinate (P2.R1) */}
          <Button
            type="button"
            variant="ai-outline"
            size="lg"
            onClick={() => setShowPromptDialog(true)}
          >
            <Eye className="mr-2 size-4" />
            View Prompt
          </Button>

          {/* Submit button */}
          <Button
            type="submit"
            disabled={isSubmitting}
            size="lg"
          >
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isSubmitting ? "Saving..." : "Save Session"}
          </Button>
        </div>
      </form>

      {/* Structured notes panel — visible after extraction */}
      {extractionState === "done" && (
        <StructuredNotesPanel
          structuredNotes={structuredNotes}
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
