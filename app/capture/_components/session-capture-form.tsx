"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2, Sparkles, RefreshCw } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ClientCombobox,
  type ClientSelection,
} from "./client-combobox"
import { DatePicker } from "./date-picker"
import { MarkdownPanel } from "./markdown-panel"
import { FileUploadZone, type ParsedAttachment } from "./file-upload-zone"
import { AttachmentList } from "./attachment-list"
import { MAX_COMBINED_CHARS } from "@/lib/constants"

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
  rawNotes: z.string().max(50000, "Notes must be 50,000 characters or fewer"),
})

type CaptureFormValues = z.infer<typeof captureFormSchema>

type ExtractionState = "idle" | "extracting" | "done"

export interface SessionCaptureFormProps {
  onSessionSaved?: () => void
}

function composeAIInput(
  rawNotes: string,
  attachments: ParsedAttachment[]
): string {
  const parts: string[] = []

  if (rawNotes.trim()) {
    parts.push(rawNotes.trim())
  }

  for (const a of attachments) {
    const label =
      a.source_format !== "generic"
        ? `[Attached file: ${a.file_name} (${a.source_format} format)]`
        : `[Attached file: ${a.file_name}]`
    parts.push(`${label}\n${a.parsed_content}`)
  }

  return parts.join("\n\n---\n\n")
}

export function SessionCaptureForm({ onSessionSaved }: SessionCaptureFormProps) {
  const {
    control,
    register,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { isSubmitting, isValid },
  } = useForm<CaptureFormValues>({
    resolver: zodResolver(captureFormSchema),
    defaultValues: {
      client: null,
      sessionDate: getToday(),
      rawNotes: "",
    },
    mode: "onChange",
  })

  // Structured notes — managed outside react-hook-form
  const [structuredNotes, setStructuredNotes] = useState<string | null>(null)
  const [lastExtractedNotes, setLastExtractedNotes] = useState<string | null>(null)
  const [extractionState, setExtractionState] = useState<ExtractionState>("idle")
  const [showReextractConfirm, setShowReextractConfirm] = useState(false)

  // File attachments — managed outside react-hook-form
  const [attachments, setAttachments] = useState<ParsedAttachment[]>([])

  // Watch rawNotes to enable/disable the extract button
  const rawNotes = watch("rawNotes")
  const hasNotes = rawNotes?.trim().length > 0
  const hasInput = hasNotes || attachments.length > 0
  const isStructuredDirty = structuredNotes !== lastExtractedNotes

  // Combined character counter
  const attachmentChars = attachments.reduce(
    (sum, a) => sum + a.parsed_content.length, 0
  )
  const totalChars = (rawNotes?.length ?? 0) + attachmentChars
  const isOverLimit = totalChars > MAX_COMBINED_CHARS

  const performExtraction = async () => {
    const notes = getValues("rawNotes")
    const composedInput = composeAIInput(notes, attachments)
    setExtractionState("extracting")

    try {
      const response = await fetch("/api/ai/extract-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNotes: composedInput }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const msg = errorData?.message ?? "Failed to extract signals"
        response.status === 402 ? toast.warning(msg) : toast.error(msg)
        setExtractionState(structuredNotes ? "done" : "idle")
        return
      }

      const { structuredNotes: extracted } = await response.json()
      setStructuredNotes(extracted)
      setLastExtractedNotes(extracted)
      setExtractionState("done")
      toast.success("Signals extracted")
    } catch (err) {
      console.error(
        "[SessionCaptureForm] extraction error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to extract signals — please try again")
      setExtractionState(structuredNotes ? "done" : "idle")
    }
  }

  const handleAddAttachment = (attachment: ParsedAttachment) => {
    setAttachments((prev) => [...prev, attachment])
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const handleExtractSignals = async () => {
    // Re-extraction confirmation if user has edited the structured notes
    if (extractionState === "done" && isStructuredDirty) {
      setShowReextractConfirm(true)
      return
    }

    await performExtraction()
  }

  const handleConfirmReextract = async () => {
    setShowReextractConfirm(false)
    await performExtraction()
  }

  const uploadAttachmentsToSession = async (
    sessionId: string,
    pendingAttachments: ParsedAttachment[]
  ) => {
    let failCount = 0

    for (const attachment of pendingAttachments) {
      try {
        const formData = new FormData()
        formData.append("file", attachment.file)
        formData.append("parsed_content", attachment.parsed_content)
        formData.append("source_format", attachment.source_format)

        const res = await fetch(`/api/sessions/${sessionId}/attachments`, {
          method: "POST",
          body: formData,
        })

        if (!res.ok) {
          failCount++
          console.error(
            `[SessionCaptureForm] attachment upload failed for "${attachment.file_name}":`,
            await res.text().catch(() => "unknown error")
          )
        }
      } catch (err) {
        failCount++
        console.error(
          `[SessionCaptureForm] attachment upload error for "${attachment.file_name}":`,
          err instanceof Error ? err.message : err
        )
      }
    }

    if (failCount > 0) {
      toast.warning(
        `${failCount} attachment${failCount > 1 ? "s" : ""} failed to upload. The session was saved.`
      )
    }
  }

  const onSubmit = async (data: CaptureFormValues) => {
    if (!hasInput) {
      toast.error("Provide notes or attach files before saving.")
      return
    }

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
      setStructuredNotes(null)
      setLastExtractedNotes(null)
      setExtractionState("idle")
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
        </div>

        {/* Attachments */}
        <div className="flex flex-col gap-2">
          <Label>Attachments</Label>
          <FileUploadZone
            onFileParsed={handleAddAttachment}
            disabled={extractionState === "extracting" || isSubmitting}
            currentCount={attachments.length}
          />
          <AttachmentList
            attachments={attachments}
            onRemove={handleRemoveAttachment}
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

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {/* Extract Signals button */}
          <Button
            type="button"
            variant="outline"
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

          {/* Submit button */}
          <Button
            type="submit"
            disabled={!isValid || !hasInput || isOverLimit || isSubmitting}
            size="lg"
          >
            {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
            {isSubmitting ? "Saving..." : "Save Session"}
          </Button>
        </div>
      </form>

      {/* Structured notes panel — visible after extraction */}
      {extractionState === "done" && structuredNotes && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-medium text-foreground">
            Extracted Signals
          </h3>
          <MarkdownPanel
            content={structuredNotes}
            onChange={setStructuredNotes}
          />
        </div>
      )}

      {/* Re-extraction confirmation dialog */}
      {showReextractConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="text-base font-semibold text-foreground">
              Re-extract Signals?
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Re-extracting will replace your edited signals. Continue?
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowReextractConfirm(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleConfirmReextract}
              >
                Re-extract
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
