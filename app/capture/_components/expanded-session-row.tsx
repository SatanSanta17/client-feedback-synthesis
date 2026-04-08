"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Sparkles, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { MAX_COMBINED_CHARS } from "@/lib/constants"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { type ClientSelection } from "./client-combobox"
import { MarkdownPanel } from "./markdown-panel"
import { type ParsedAttachment } from "./file-upload-zone"
import { composeAIInput } from "@/lib/utils/compose-ai-input"
import { uploadAttachmentsToSession } from "@/lib/utils/upload-attachments"
import type { SessionAttachment } from "@/lib/services/attachment-service"
import { useSignalExtraction } from "@/lib/hooks/use-signal-extraction"
import { ReextractConfirmDialog } from "@/components/capture/reextract-confirm-dialog"
import { ExpandedSessionMetadata } from "./expanded-session-metadata"
import { ExpandedSessionNotes } from "./expanded-session-notes"
import { ExpandedSessionActions } from "./expanded-session-actions"
import { PromptVersionBadge } from "./prompt-version-badge"

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
  updated_by_email?: string
  attachment_count: number
  prompt_version_id: string | null
  extraction_stale: boolean
  structured_notes_edited: boolean
  updated_by: string | null
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

  // Signal extraction via shared hook
  const getExtractionInput = useCallback(
    () => composeAIInput(rawNotes, [...savedAttachments, ...pendingAttachments]),
    [rawNotes, savedAttachments, pendingAttachments]
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
  } = useSignalExtraction({
    getInput: getExtractionInput,
    initialStructuredNotes: session.structured_notes,
    forceConfirmOnReextract: session.structured_notes_edited,
  })

  // Derived state
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
      const didExtract = promptVersionId !== null
      const inputChanged =
        rawNotes !== session.raw_notes ||
        pendingAttachments.length > 0 ||
        deletedAttachmentIds.size > 0

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
          promptVersionId: promptVersionId,
          isExtraction: didExtract,
          inputChanged,
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
  }, [session.id, session.raw_notes, client, sessionDate, rawNotes, structuredNotes, promptVersionId, isFormValid, onSave, savedAttachments, pendingAttachments, deletedAttachmentIds])

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
      <ExpandedSessionMetadata
        canEdit={canEdit}
        client={client}
        onClientChange={setClient}
        sessionDate={sessionDate}
        onSessionDateChange={setSessionDate}
        session={session}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExpandedSessionNotes
          rawNotes={rawNotes}
          onRawNotesChange={setRawNotes}
          canEdit={canEdit}
          sessionId={session.id}
          savedAttachments={savedAttachments}
          pendingAttachments={pendingAttachments}
          isLoadingAttachments={isLoadingAttachments}
          structuredNotes={structuredNotes}
          extractionState={extractionState}
          isSaving={isSaving}
          totalChars={totalChars}
          isOverLimit={isOverLimit}
          totalAttachmentCount={totalAttachmentCount}
          onSavedAttachmentDeleted={handleSavedAttachmentDeleted}
          onAddPendingAttachment={handleAddPendingAttachment}
          onRemovePendingAttachment={handleRemovePendingAttachment}
        />

        {/* Extracted signals panel — kept inline (minimal logic) */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Extracted Signals</Label>
              {session.prompt_version_id && (
                <PromptVersionBadge promptVersionId={session.prompt_version_id} />
              )}
              {session.extraction_stale && session.structured_notes && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-[var(--status-warning)] text-[var(--status-warning)]"
                >
                  Extraction may be outdated
                </Badge>
              )}
            </div>
            {canEdit && (
              <Button
                type="button"
                variant="ai"
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

      <ExpandedSessionActions
        canEdit={canEdit}
        isFormValid={isFormValid}
        isDirty={isDirty}
        isSaving={isSaving}
        isDeleting={isDeleting}
        isOverLimit={isOverLimit}
        showDeleteConfirm={showDeleteConfirm}
        onSave={handleSave}
        onCancel={onCancel}
        onDelete={handleDelete}
        onShowDeleteConfirm={setShowDeleteConfirm}
      />

      <ReextractConfirmDialog
        show={showReextractConfirm}
        hasManualEdits={session.structured_notes_edited}
        onConfirm={handleConfirmReextract}
        onCancel={dismissReextractConfirm}
      />
    </div>
  )
}
