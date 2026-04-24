"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useAuth } from "@/components/providers/auth-provider"
import {
  SessionFilters,
  type SessionFiltersState,
} from "./session-filters"
import { UnsavedChangesDialog } from "./unsaved-changes-dialog"
import { type SessionRow } from "./expanded-session-row"
import { SessionTableRow } from "./session-table-row"

export interface PastSessionsTableProps {
  refreshKey: number
}

const PAGE_SIZE = 20

export function PastSessionsTable({
  refreshKey,
}: PastSessionsTableProps) {
  const { user, isLoading: isAuthLoading, activeTeamId } = useAuth()
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [filters, setFilters] = useState<SessionFiltersState>({
    dateFrom: "",
    dateTo: "",
  })
  const [teamRole, setTeamRole] = useState<string | null>(null)
  const isTeamContext = !!activeTeamId

  useEffect(() => {
    if (!activeTeamId) {
      setTeamRole(null)
      return
    }
    fetch("/api/teams")
      .then((res) => (res.ok ? res.json() : { teams: [] }))
      .then((data) => {
        const team = (data.teams ?? []).find(
          (t: { id: string }) => t.id === activeTeamId
        )
        setTeamRole(team?.role ?? null)
      })
      .catch(() => setTeamRole(null))
  }, [activeTeamId])

  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null)
  const [pendingExpandId, setPendingExpandId] = useState<string | null>(null)
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)

  const isDirtyRef = useRef(false)
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
        if (filters.promptVersionId) {
          if (filters.promptVersionId === "null") {
            params.set("promptVersionNull", "true")
          } else {
            params.set("promptVersionId", filters.promptVersionId)
          }
        }

        const response = await fetch(`/api/sessions?${params.toString()}`)
        if (!response.ok) {
          console.error("[PastSessionsTable] fetch failed:", response.status, response.url)
          return
        }

        const contentType = response.headers.get("content-type") ?? ""
        if (!contentType.includes("application/json")) {
          console.error("[PastSessionsTable] unexpected content-type:", contentType, "url:", response.url, "status:", response.status)
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

  useEffect(() => {
    if (isAuthLoading || !user) return
    setOffset(0)
    fetchSessions(0, false)
  }, [filters, refreshKey, fetchSessions, activeTeamId, isAuthLoading, user?.id])

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
    if (expandedSessionId === sessionId) {
      if (isDirtyRef.current) {
        setPendingExpandId(null)
        setShowUnsavedDialog(true)
      } else {
        setExpandedSessionId(null)
      }
      return
    }

    if (expandedSessionId && isDirtyRef.current) {
      setPendingExpandId(sessionId)
      setShowUnsavedDialog(true)
      return
    }

    setExpandedSessionId(sessionId)
    isDirtyRef.current = false
  }, [expandedSessionId])

  const handleDirtyChange = useCallback((dirty: boolean) => {
    isDirtyRef.current = dirty
  }, [])

  const handleExpandedSave = useCallback((updated: SessionRow) => {
    isDirtyRef.current = false
    setSessions((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    )
  }, [])

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
    setExpandedSessionId(pendingExpandId)
    setPendingExpandId(null)
  }, [pendingExpandId])

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

      <div className="mb-4">
        <SessionFilters
          filters={filters}
          onFiltersChange={handleFiltersChange}
        />
      </div>

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
                {isTeamContext && (
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Captured by
                  </th>
                )}
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const isExpanded = expandedSessionId === session.id
                const isOwner = session.created_by === user?.id
                const canEdit = !isTeamContext || isOwner || teamRole === "admin"
                return (
                  <SessionTableRow
                    key={session.id}
                    session={session}
                    isExpanded={isExpanded}
                    isTeamContext={isTeamContext}
                    canEdit={canEdit}
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

      <UnsavedChangesDialog
        open={showUnsavedDialog}
        onSave={handleUnsavedSave}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
      />
    </div>
  )
}
