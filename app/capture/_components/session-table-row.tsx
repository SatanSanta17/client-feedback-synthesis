"use client"

import { Sparkles, Paperclip, AlertTriangle } from "lucide-react"

import { ExpandedSessionRow, type SessionRow } from "./expanded-session-row"

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

function formatEmail(email?: string): string {
  if (!email) return ""
  const [local] = email.split("@")
  return local
}

interface SessionTableRowProps {
  session: SessionRow
  isExpanded: boolean
  isTeamContext: boolean
  canEdit: boolean
  onRowClick: () => void
  onDirtyChange: (dirty: boolean) => void
  onSave: () => void
  onCancel: () => void
  onDelete: () => void
  saveRef: React.MutableRefObject<(() => Promise<boolean>) | null>
}

export function SessionTableRow({
  session,
  isExpanded,
  isTeamContext,
  canEdit,
  onRowClick,
  onDirtyChange,
  onSave,
  onCancel,
  onDelete,
  saveRef,
}: SessionTableRowProps) {
  const colSpan = isTeamContext ? 4 : 3

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
        {isTeamContext && (
          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
            {formatEmail(session.created_by_email)}
          </td>
        )}
        <td className="px-4 py-2.5 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            {truncateNotes(session.raw_notes)}
            {session.attachment_count > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                <Paperclip className="size-3.5" />
                <span className="text-xs">{session.attachment_count}</span>
              </span>
            )}
            {session.structured_notes && (
              <>
                <Sparkles className="size-3.5 shrink-0 text-primary/60" />
                {session.extraction_stale && (
                  <AlertTriangle className="size-3 shrink-0 text-[var(--status-warning)]" />
                )}
              </>
            )}
          </span>
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={colSpan} className="p-0">
            <ExpandedSessionRow
              session={session}
              canEdit={canEdit}
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
