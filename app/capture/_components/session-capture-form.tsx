"use client"

import { useState } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2, Sparkles, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  ClientCombobox,
  type ClientSelection,
} from "./client-combobox"
import { DatePicker } from "./date-picker"
import { MarkdownPanel } from "./markdown-panel"

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
  rawNotes: z
    .string()
    .min(1, "Notes are required")
    .max(50000, "Notes must be 50,000 characters or fewer"),
})

type CaptureFormValues = z.infer<typeof captureFormSchema>

type ExtractionState = "idle" | "extracting" | "done"

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

  // Watch rawNotes to enable/disable the extract button
  const rawNotes = watch("rawNotes")
  const hasNotes = rawNotes?.trim().length > 0
  const isStructuredDirty = structuredNotes !== lastExtractedNotes

  const performExtraction = async () => {
    const notes = getValues("rawNotes")
    setExtractionState("extracting")

    try {
      const response = await fetch("/api/ai/extract-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNotes: notes }),
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

  const onSubmit = async (data: CaptureFormValues) => {
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

      toast.success("Session saved")
      reset({
        client: null,
        sessionDate: getToday(),
        rawNotes: "",
      })
      // Reset extraction state
      setStructuredNotes(null)
      setLastExtractedNotes(null)
      setExtractionState("idle")
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

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          {/* Extract Signals button */}
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={!hasNotes || extractionState === "extracting"}
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
            disabled={!isValid || isSubmitting}
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
