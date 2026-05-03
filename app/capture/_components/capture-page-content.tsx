"use client"

import { useState } from "react"

import { SessionCaptureForm } from "./session-capture-form"
import { PastSessionsTable } from "./past-sessions-table"
import { type SessionRow } from "./expanded-session-row"

export function CapturePageContent() {
  const [newSession, setNewSession] = useState<SessionRow | null>(null)

  return (
    <>
      <SessionCaptureForm onSessionSaved={setNewSession} />
      <div className="mt-8 w-full max-w-4xl">
        <PastSessionsTable newSession={newSession} />
      </div>
    </>
  )
}
