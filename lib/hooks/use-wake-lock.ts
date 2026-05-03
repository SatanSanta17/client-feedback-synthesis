"use client"

import { useEffect, useRef } from "react"

export function useWakeLock(active: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    if (!active) return

    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      console.warn("[use-wake-lock] Wake Lock API unavailable in this browser")
      return
    }

    let cancelled = false

    const acquire = async () => {
      try {
        const sentinel = await navigator.wakeLock.request("screen")
        if (cancelled) {
          await sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        sentinel.addEventListener("release", () => {
          sentinelRef.current = null
        })
      } catch (err) {
        console.warn("[use-wake-lock] Failed to acquire wake lock:", err)
      }
    }

    // Browsers release the lock when the tab hides — re-acquire on visible.
    const onVisibility = () => {
      if (document.visibilityState === "visible" && !sentinelRef.current) {
        acquire()
      }
    }

    acquire()
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", onVisibility)
      sentinelRef.current?.release().catch(() => {})
      sentinelRef.current = null
    }
  }, [active])
}
