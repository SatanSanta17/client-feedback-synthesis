"use client"

import { useEffect } from "react"

// Covers the well-supported half: full page unloads (close tab, refresh,
// external nav). Next.js client-side navigation is a known browser-API gap;
// the calling component should also surface a "don't navigate away" UI
// affordance for in-app links.
export function useBeforeUnloadGuard(
  active: boolean,
  message = "Processing in progress. Leave anyway?",
): void {
  useEffect(() => {
    if (!active) return

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = message
      return message
    }

    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [active, message])
}
