"use client"

import { useEffect } from "react"

// Modern browsers ignore the message string and show their own prompt — the
// only thing the page can control is whether the prompt fires. This covers
// page unloads (close tab, refresh, external nav). Next.js client-side
// navigation is a known browser-API gap; the calling component should also
// surface a "don't navigate away" UI affordance for in-app links.
export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return

    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }

    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [active])
}
