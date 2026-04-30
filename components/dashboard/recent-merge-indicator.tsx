import { GitMerge } from "lucide-react";

import { cn } from "@/lib/utils";

interface RecentMergeIndicatorProps {
  className?: string;
}

/**
 * "Recently merged" badge shown next to canonical theme names on the
 * dashboard widgets that aggregate by theme (PRD-026 Part 4 P4.R2).
 *
 * Subtle on purpose — small icon, muted colour, native browser tooltip via
 * `title`. The detailed merge audit lives at `/settings/themes` (Part 3's
 * "Recent merges" section); this indicator is only a heads-up that a row's
 * meaning recently changed.
 */
export function RecentMergeIndicator({ className }: RecentMergeIndicatorProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center text-[var(--text-muted)]",
        className
      )}
      title="Recently merged"
      aria-label="Recently merged"
    >
      <GitMerge className="size-3.5" aria-hidden />
    </span>
  );
}
