"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Loader2, Save, X, Trash2, Sparkles, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  ClientCombobox,
  type ClientSelection,
} from "./client-combobox"
import { DatePicker } from "./date-picker"
import { MarkdownPanel } from "./markdown-panel"
import {
  SessionFilters,
  type SessionFiltersState,
} from "./session-filters"
import { UnsavedChangesDialog } from "./unsaved-changes-dialog"

type ExtractionState = "idle" | "extracting" | "done"

interface SessionRow {
  id: string
  client_id: string
  client_name: string
  session_date: string
  raw_notes: string
  structured_notes: string | null
  created_at: string
}

export interface PastSessionsTableProps {
  refreshKey: number
}

const PAGE_SIZE = 20

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00")
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function truncateNotes(notes: string, maxLength = 100): string {
  if (notes.length <= maxLength) return notes
  return notes.slice(0, maxLength).trimEnd() + "…"
}

export function PastSessionsTable({
  refreshKey,
}: PastSessionsTableProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [filters, setFilters] = useState<SessionFiltersState>({
    dateFrom: "",
    dateTo: "",
  })

  // Expand/collapse state
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [pendingExpandId, setPendingExpandId] = useState<string | null>(null)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)

  // Track dirty state of the currently expanded row
  const isDirtyRef = useRef(false)

  // Ref to the save function of the currently expanded row
  const saveExpandedRef = useRef<(() => Promise<boolean>) | null>(null)

  const fetchSessions = useCallback(
    async (currentOffset: number, append: boolean) => {
      if (append) {
        setIsLoadingMore(true)
      } else {
        setIsLoading(true)
      }

      try {
        const params = new URLSearchParams({
          offset: String(currentOffset),
          limit: String(PAGE_SIZE),
        })
        if (filters.clientId) {
          params.set("clientId", filters.clientId)
        }
        if (filters.dateFrom) {
          params.set("dateFrom", filters.dateFrom)
        }
        if (filters.dateTo) {
          params.set("dateTo", filters.dateTo)
        }

        const response = await fetch(`/api/sessions?${params.toString()}`)
        if (!response.ok) {
          console.error("[PastSessionsTable] fetch failed:", response.status)
          return
        }

        const data = await response.json()
        const fetched: SessionRow[] = data.sessions ?? []

        if (append) {
          setSessions((prev) => [...prev, ...fetched])
        } else {
          setSessions(fetched)
        }
        setTotal(data.total ?? 0)
      } catch (err) {
        console.error(
          "[PastSessionsTable] fetch error:",
          err instanceof Error ? err.message : err
        )
      } finally {
        setIsLoading(false)
        setIsLoadingMore(false)
      }
    },
    [filters]
  )

  // Fetch on mount, filter change, or refreshKey change
  useEffect(() => {
    setOffset(0)
    fetchSessions(0, false)
  }, [filters, refreshKey, fetchSessions])

  const handleLoadMore = () => {
    const newOffset = offset + PAGE_SIZE
    setOffset(newOffset)
    fetchSessions(newOffset, true)
  }

  const handleFiltersChange = (newFilters: SessionFiltersState) => {
    setFilters(newFilters)
  }

  // --- Row expand logic ---
  const handleRowClick = useCallback((sessionId: string) => {
    // Clicking the already-expanded row → collapse it
    if (expandedSessionId === sessionId) {
      if (isDirtyRef.current) {
        setPendingExpandId(null)
        setShowUnsavedDialog(true)
      } else {
        setExpandedSessionId(null)
      }
      return
    }

    // Clicking a different row while one is expanded and dirty
    if (expandedSessionId && isDirtyRef.current) {
      setPendingExpandId(sessionId)
      setShowUnsavedDialog(true)
      return
    }

    // No row expanded or current row is clean → expand new row
    setExpandedSessionId(sessionId)
    isDirtyRef.current = false
  }, [expandedSessionId])

  const handleDirtyChange = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty
  }, [])

  const handleExpandedSave = useCallback(() => {
    setExpandedSessionId(null)
    isDirtyRef.current = false
    setOffset(0)
    fetchSessions(0, false)
  }, [fetchSessions])

  const handleExpandedCancel = useCallback(() => {
    setExpandedSessionId(null)
    isDirtyRef.current = false
  }, [])

  const handleExpandedDelete = useCallback(() => {
    setExpandedSessionId(null)
    isDirtyRef.current = false
    setOffset(0)
    fetchSessions(0, false)
  }, [fetchSessions])

  // --- Unsaved changes dialog handlers ---
  const handleUnsavedSave = useCallback(async () => {
    const saveFn = saveExpandedRef.current
    if (saveFn) {
      const success = await saveFn()
      if (!success) {
        setShowUnsavedDialog(false)
        setPendingExpandId(null)
        return
      }
    }

    setShowUnsavedDialog(false)
    isDirtyRef.current = false
    setOffset(0)
    await fetchSessions(0, false)
    setExpandedSessionId(pendingExpandId)
    setPendingExpandId(null)
  }, [pendingExpandId, fetchSessions])

  const handleUnsavedDiscard = useCallback(() => {
    setShowUnsavedDialog(false)
    isDirtyRef.current = false
    setExpandedSessionId(pendingExpandId)
    setPendingExpandId(null)
  }, [pendingExpandId])

  const handleUnsavedCancel = useCallback(() => {
    setShowUnsavedDialog(false)
    setPendingExpandId(null)
  }, [])

  const hasMore = sessions.length < total

  return (
    <div className="w-full max-w-4xl">
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        Past Sessions
      </h2>

      {/* Filters */}
      <div className="mb-4">
        <SessionFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-border py-12 text-center text-sm text-muted-foreground">
          No sessions found.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Client
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Date
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const isExpanded = expandedSessionId === session.id
                return (
                  <SessionTableRow
                    key={session.id}
                    session={session}
                    isExpanded={isExpanded}
                    onRowClick={() => handleRowClick(session.id)}
                    onDirtyChange={handleDirtyChange}
                    onSave={handleExpandedSave}
                    onCancel={handleExpandedCancel}
                    onDelete={handleExpandedDelete}
                    saveRef={saveExpandedRef}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Load more */}
      {hasMore && !isLoading && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore && (
              <Loader2 className="mr-2 size-3.5 animate-spin" />
            )}
            {isLoadingMore ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      {/* Unsaved changes dialog */}
      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSave={handleUnsavedSave}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
      />
    </div>
  )
}

// --- Session table row with expandable edit form ---

interface SessionTableRowProps {
  session: SessionRow
  isExpanded: boolean
  onRowClick: () => void
  onDirtyChange: (dirty: boolean) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  saveRef: React.MutableRefObject<(() => Promise<boolean>) | null>
}

function SessionTableRow({
  session,
  isExpanded,
  onRowClick,
  onDirtyChange,
  onSave,
  onCancel,
  onDelete,
  saveRef,
}: SessionTableRowProps) {
  return (
    <>
      <tr
        onClick={onRowClick}
        className={`cursor-pointer border-b last:border-b-0 transition-colors hover:bg-muted/30 ${
          isExpanded ? "bg-muted/40" : ""
        }`}
      >
        <td className="px-4 py-2.5 font-medium">
          {session.client_name}
        </td>
        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
          {formatDate(session.session_date)}
        </td>
        <td className="px-4 py-2.5 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {truncateNotes(session.raw_notes)}
            {session.structured_notes && (
              <Sparkles className="size-3.5 shrink-0 text-primary/60" />
            )}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={3} className="p-0">
            <ExpandedSessionRow
              session={session}
              onSave={onSave}
              onCancel={onCancel}
              onDelete={onDelete}
              onDirtyChange={onDirtyChange}
              registerSave={(saveFn) => { saveRef.current = saveFn }}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// --- Expanded session row (inline edit form) ---

interface ExpandedSessionRowProps {
  session: SessionRow
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  onDirtyChange: (dirty: boolean) => void
  registerSave: (saveFn: () => Promise<boolean>) => void
}

function ExpandedSessionRow({
  session,
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

  // Signal extraction state
  const [structuredNotes, setStructuredNotes] = useState<string | null>(session.structured_notes)
  const [lastExtractedNotes, setLastExtractedNotes] = useState<string | null>(session.structured_notes)
  const [extractionState, setExtractionState] = useState<ExtractionState>(
    session.structured_notes ? "done" : "idle"
  )
  const [showReextractConfirm, setShowReextractConfirm] = useState(false)

  const isStructuredDirty = structuredNotes !== lastExtractedNotes

  const isDirty =
    client.id !== session.client_id ||
    client.name !== session.client_name ||
    sessionDate !== session.session_date ||
    rawNotes !== session.raw_notes ||
    structuredNotes !== session.structured_notes

  const isFormValid =
    client.name.trim().length > 0 &&
    sessionDate.length > 0 &&
    rawNotes.trim().length > 0

  useEffect(() => {
    onDirtyChange(isDirty)
  }, [isDirty, onDirtyChange])

  // --- Signal extraction ---
  const performExtraction = useCallback(async () => {
    setExtractionState("extracting")

    try {
      const response = await fetch("/api/ai/extract-signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNotes }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        toast.error(errorData?.message ?? "Failed to extract signals")
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
  }, [rawNotes, structuredNotes])

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
  }, [session.id, client, sessionDate, rawNotes, structuredNotes, isFormValid, onSave])

  // Register save function so parent can call it from the unsaved changes dialog
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
      {/* Client field */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Client</Label>
        <ClientCombobox
          value={client}
          onChange={(c) => {
            if (c) setClient(c)
          }}
        />
      </div>

      {/* Session Date field */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Session Date</Label>
        <DatePicker
          value={sessionDate}
          onChange={setSessionDate}
          className="w-48"
        />
      </div>

      {/* Notes — side by side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Raw Notes */}
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Raw Notes</Label>
          <MarkdownPanel
            content={rawNotes}
            onChange={setRawNotes}
          />
        </div>

        {/* Right: Structured Notes */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Extracted Signals</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!rawNotes.trim() || extractionState === "extracting"}
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
          </div>

          {extractionState === "done" && structuredNotes ? (
            <MarkdownPanel
              content={structuredNotes}
              onChange={setStructuredNotes}
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

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!isFormValid || !isDirty || isSaving || isDeleting}
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
      </div>

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
