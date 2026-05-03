"use client"

import { Badge } from "@/components/ui/badge"
import { formatRelativeTime } from "@/lib/utils/format-relative-time"

interface EditedBadgeProps {
  // Saved transcripts pass the `last_edited_at` column value (ISO string)
  // and get a hover tooltip with the relative time. Pending transcripts
  // (edited but not yet persisted) pass null and get the badge alone.
  timestamp?: string | null
}

// PRD-032 Part 3 — small "edited" indicator on transcript rows. Native
// `title` attribute on a wrapping span is the project's existing pattern
// for hover tooltips (no shadcn `<Tooltip>` primitive is installed; if one
// later lands, this is a one-file swap).
export function EditedBadge({ timestamp }: EditedBadgeProps) {
  const badge = (
    <Badge variant="secondary" className="shrink-0 text-[10px]">
      edited
    </Badge>
  )

  if (!timestamp) return badge

  return <span title={`Edited ${formatRelativeTime(timestamp)}`}>{badge}</span>
}
