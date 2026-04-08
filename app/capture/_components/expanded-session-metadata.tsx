"use client"

import { Label } from "@/components/ui/label"
import {
  ClientCombobox,
  type ClientSelection,
} from "./client-combobox"
import { DatePicker } from "./date-picker"

interface ExpandedSessionMetadataProps {
  canEdit: boolean
  client: ClientSelection
  onClientChange: (client: ClientSelection) => void
  sessionDate: string
  onSessionDateChange: (date: string) => void
  session: Pick<
    { client_name: string; session_date: string; created_by_email?: string; updated_by_email?: string },
    "client_name" | "session_date" | "created_by_email" | "updated_by_email"
  >
}

export function ExpandedSessionMetadata({
  canEdit,
  client,
  onClientChange,
  sessionDate,
  onSessionDateChange,
  session,
}: ExpandedSessionMetadataProps) {
  if (!canEdit) {
    return (
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
        {session.updated_by_email && (
          <div>
            <span className="text-xs text-muted-foreground">Last edited by</span>
            <p className="font-medium">{session.updated_by_email}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Client</Label>
        <ClientCombobox
          value={client}
          onChange={(c) => {
            if (c) onClientChange(c)
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Session Date</Label>
        <DatePicker
          value={sessionDate}
          onChange={onSessionDateChange}
          className="w-48"
        />
      </div>
    </>
  )
}
