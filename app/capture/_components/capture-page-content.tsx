"use client"

import { useState, useCallback } from "react"

import { SessionCaptureForm } from "./session-capture-form"
import { PastSessionsTable } from "./past-sessions-table"

/**
 * Client wrapper for the capture page.
 * Manages the refreshKey shared between the form and table.
 */
export function CapturePageContent() {
  const [refreshKey, setRefreshKey] = useState(0)

  const handleSessionSaved = useCallback(() => {
    setRefreshKey((prev) => prev + 1)
  }, [])

  return (
    <>
      <SessionCaptureForm onSessionSaved={handleSessionSaved} />
      <div className="mt-8 w-full max-w-4xl">
        <PastSessionsTable refreshKey={refreshKey} />
      </div>
    </>
  )
}
