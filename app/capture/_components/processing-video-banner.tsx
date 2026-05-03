"use client"

import { Info } from "lucide-react"

interface ProcessingVideoBannerProps {
  active: boolean
}

export function ProcessingVideoBanner({ active }: ProcessingVideoBannerProps) {
  if (!active) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-primary" />
      <p>
        Processing video — please keep this tab open. Background tabs run slower.
      </p>
    </div>
  )
}
