"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Save, X, Trash2, Sparkles, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { MAX_COMBINED_CHARS } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  ClientCombobox,
  type ClientSelection,
} from "./client-combobox"
import { DatePicker } from "./date-picker"
import { MarkdownPanel } from "./markdown-panel"
import { FileUploadZone, type ParsedAttachment } from "./file-upload-zone"
import { AttachmentList } from "./attachment-list"
import { SavedAttachmentList } from "./saved-attachment-list"
import { composeAIInput } from "@/lib/utils/compose-ai-input"
import { uploadAttachmentsToSession } from "@/lib/utils/upload-attachments"
import type { SessionAttachment } from "@/lib/services/attachment-service"

type ExtractionState = "idle" | "extracting" | "done"

export interface SessionRow {
  id: string
  client_id: string
  client_name: string
  session_date: string
  raw_notes: string
  structured_notes: string | null
  created_by: string
  created_at: string
  created_by_email?: string
  attachment_count: number
}

export interface ExpandedSessionRowProps {
  session: SessionRow
  canEdit: boolean
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onDirtyChange: (dirty: boolean) => void
  registerSave: (saveFn: () => Promise<boolean>) => void
}

export function ExpandedSessionRow({
  session,
  canEdit,
  onSave,
  onCancel,
  onDelete,
  onDirtyChange,
  registerSave,
}: ExpandedSessionRowProps) {
  const [client, setClient] = useState<ClientSelection>({
    id: session.client_id,
    name: session.client_name,
  })
  const [sessionDate, setSessionDate] = useState(session.session_date)
  const [rawNotes, setRawNotes] = useState(session.raw_notes)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const [structuredNotes, setStructuredNotes] = useState<string | null>(session.structured_notes)
  const [lastExtractedNotes, setLastExtractedNotes] = useState<string | null>(session.structured_notes)
  const [extractionState, setExtractionState] = useState<ExtractionState>(
    session.structured_notes ? "done" : "idle"
  )
  const [showReextractConfirm, setShowReextractConfirm] = useState(false)

  // Attachment state
  const [savedAttachments, setSavedAttachments] = useState<SessionAttachment[]>([])
  const [pendingAttachments, setPendingAttachments] = useState<ParsedAttachment[]>([])
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(true)
  const [deletedAttachmentIds, setDeletedAttachmentIds] = useState<Set<string>>(new Set())

  // Fetch saved attachments on mount
  useEffect(() => {
    let cancelled = false
    setIsLoadingAttachments(true)

    fetch(`/api/sessions/${session.id}/attachments`)
      .then((res) => (res.ok ? res.json() : { attachments: [] }))
      .then((data) => {
        if (!cancelled) setSavedAttachments(data.attachments ?? [])
      })
      .catch(() => {
        if (!cancelled) setSavedAttachments([])
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAttachments(false)
      })

    return () => { cancelled = true }
  }, [session.id])

  const isStructuredDirty = structuredNotes !== lastExtractedNotes

  const isDirty =
    client.id !== session.client_id ||
    client.name !== session.client_name ||
    sessionDate !== session.session_date ||
    rawNotes !== session.raw_notes ||
    structuredNotes !== session.structured_notes ||
    pendingAttachments.length > 0 ||
    deletedAttachmentIds.size > 0

  const hasInput =
    rawNotes.trim().length > 0 ||
    savedAttachments.length > 0 ||
    pendingAttachments.length > 0

  const isFormValid =
    client.name.trim().length > 0 &&
    sessionDate.length > 0 &&
    hasInput

  // Combined character counter
  const savedAttachmentChars = savedAttachments.reduce(
    (sum, a) => sum + a.parsed_content.length, 0
  )
  const pendingAttachmentChars = pendingAttachments.reduce(
    (sum, a) => sum + a.parsed_content.length, 0
  )
  const totalChars = (rawNotes?.length ?? 0) + savedAttachmentChars + pendingAttachmentChars
  const isOverLimit = totalChars > MAX_COMBINED_CHARS
  const totalAttachmentCount = savedAttachments.length + pendingAttachments.length

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  const composeExpandedAIInput = useCallback(
    () => composeAIInput(rawNotes, [...savedAttachments, ...pendingAttachments]),
    [rawNotes, savedAttachments, pendingAttachments]
  )

  // --- Signal extraction ---
  const performExtraction = useCallback(async () => {
    setExtractionState("extracting")

    try {
      const response = await fetch("/api/ai/extract-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNotes: composeExpandedAIInput() }),
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
        "[ExpandedSessionRow] extraction error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to extract signals — please try again")
      setExtractionState(structuredNotes ? "done" : "idle")
    }
  }, [composeExpandedAIInput, structuredNotes])

  const handleExtractSignals = useCallback(async () => {
    if (extractionState === "done" && isStructuredDirty) {
      setShowReextractConfirm(true)
      return
    }
    await performExtraction()
  }, [extractionState, isStructuredDirty, performExtraction])

  const handleConfirmReextract = useCallback(async () => {
    setShowReextractConfirm(false)
    await performExtraction()
  }, [performExtraction])

  // --- Attachment handlers ---
  const handleSavedAttachmentDeleted = useCallback((attachmentId: string) => {
    setSavedAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
    setDeletedAttachmentIds((prev) => new Set(prev).add(attachmentId))
  }, [])

  const handleAddPendingAttachment = useCallback((attachment: ParsedAttachment) => {
    setPendingAttachments((prev) => [...prev, attachment])
  }, [])

  const handleRemovePendingAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // --- Save ---
  const handleSave = useCallback(async (): Promise<boolean> => {
    if (!isFormValid) return false

    setIsSaving(true)
    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: client.id,
          clientName: client.name,
          sessionDate,
          rawNotes,
          structuredNotes,
          hasAttachments: savedAttachments.length + pendingAttachments.length > 0,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const message = errorData?.message ?? "Failed to update session"

        if (response.status === 409) {
          toast.error(`Client "${client.name}" already exists. Please select it from the list.`)
        } else if (response.status === 404) {
          toast.error("Session not found — it may have been deleted.")
        } else {
          toast.error(message)
        }
        return false
      }

      if (pendingAttachments.length > 0) {
        await uploadAttachmentsToSession(session.id, pendingAttachments)
      }

      toast.success("Session updated")
      onSave()
      return true
    } catch (err) {
      console.error(
        "[ExpandedSessionRow] save error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to update session — please try again")
      return false
    } finally {
      setIsSaving(false)
    }
  }, [session.id, client, sessionDate, rawNotes, structuredNotes, isFormValid, onSave, savedAttachments, pendingAttachments])

  useEffect(() => {
    registerSave(handleSave)
  }, [handleSave, registerSave])

  // --- Delete ---
  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "DELETE",
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        const message = errorData?.message ?? "Failed to delete session"

        if (response.status === 404) {
          toast.error("Session not found — it may have already been deleted.")
        } else {
          toast.error(message)
        }
        return
      }

      toast.success("Session deleted")
      onDelete()
    } catch (err) {
      console.error(
        "[ExpandedSessionRow] delete error:",
        err instanceof Error ? err.message : err
      )
      toast.error("Failed to delete session — please try again")
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }, [session.id, onDelete])

  return (
    <div className="flex flex-col gap-4 p-4 bg-muted/20 border-t border-border">
      {canEdit ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Client</Label>
            <ClientCombobox
              value={client}
              onChange={(c) => {
                if (c) setClient(c)
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Session Date</Label>
            <DatePicker
              value={sessionDate}
              onChange={setSessionDate}
              className="w-48"
            />
          </div>
        </>
      ) : (
        <div className="flex items-center gap-6 text-sm">
          <div>
            <span className="text-xs text-muted-foreground">Client</span>
            <p className="font-medium">{session.client_name}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Date</span>
            <p className="font-medium">{session.session_date}</p>
          </div>
          {session.created_by_email && (
            <div>
              <span className="text-xs text-muted-foreground">Captured by</span>
              <p className="font-medium">{session.created_by_email}</p>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Raw Notes</Label>
          <MarkdownPanel
            content={rawNotes}
            onChange={canEdit ? setRawNotes : undefined}
            readOnly={!canEdit}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Extracted Signals</Label>
            {canEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasInput || isOverLimit || extractionState === "extracting"}
                onClick={handleExtractSignals}
              >
                {extractionState === "extracting" ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    Extracting...
                  </>
                ) : extractionState === "done" ? (
                  <>
                    <RefreshCw className="mr-1.5 size-3.5" />
                    Re-extract
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1.5 size-3.5" />
                    Extract Signals
                  </>
                )}
              </Button>
            )}
          </div>

          {extractionState === "done" && structuredNotes ? (
            <MarkdownPanel
              content={structuredNotes}
              onChange={canEdit ? setStructuredNotes : undefined}
              readOnly={!canEdit}
            />
          ) : extractionState === "extracting" ? (
            <div className="flex items-center justify-center rounded-lg border border-border bg-card py-12">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-sm text-muted-foreground">
              No signals extracted yet.
            </div>
          )}
        </div>
      </div>

      {/* Attachments section */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs text-muted-foreground">Attachments</Label>

        {isLoadingAttachments ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Loading attachments…
          </div>
        ) : (
          <SavedAttachmentList
            attachments={savedAttachments}
            sessionId={session.id}
            canEdit={canEdit}
            hasStructuredNotes={!!structuredNotes}
            onDeleted={handleSavedAttachmentDeleted}
          />
        )}

        <AttachmentList
          attachments={pendingAttachments}
          onRemove={handleRemovePendingAttachment}
        />

        {canEdit && (
          <FileUploadZone
            onFileParsed={handleAddPendingAttachment}
            disabled={isSaving || extractionState === "extracting"}
            currentCount={totalAttachmentCount}
          />
        )}

        {(savedAttachments.length > 0 || pendingAttachments.length > 0 || rawNotes.length > 0) && (
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
        )}
      </div>

      <div className="flex items-center gap-2">
        {canEdit ? (
          <>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!isFormValid || !isDirty || isSaving || isDeleting || isOverLimit}
            >
              {isSaving ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Save className="mr-1.5 size-3.5" />
              )}
              {isSaving ? "Saving..." : "Save"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
              disabled={isSaving || isDeleting}
            >
              <X className="mr-1.5 size-3.5" />
              Cancel
            </Button>

            <div className="ml-auto">
              {showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    Delete this session?
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isDeleting}
                  >
                    {isDeleting && (
                      <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                    )}
                    {isDeleting ? "Deleting..." : "Confirm"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isSaving || isDeleting}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="mr-1.5 size-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onCancel}
            >
              <X className="mr-1.5 size-3.5" />
              Close
            </Button>
            <span className="text-xs text-muted-foreground">
              View only — you can only edit your own sessions
            </span>
          </div>
        )}
      </div>

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
