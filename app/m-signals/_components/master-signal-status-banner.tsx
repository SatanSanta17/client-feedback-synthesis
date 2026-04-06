"use client"

import { AlertTriangle, Info } from "lucide-react"

import { cn } from "@/lib/utils"

type BannerVariant = "tainted" | "stale" | "info"

interface MasterSignalStatusBannerProps {
  variant: BannerVariant
  staleCount?: number
}

const VARIANT_STYLES: Record<BannerVariant, { border: string; bg: string; text: string }> = {
  tainted: {
    border: "border-[var(--status-warning-border)]",
    bg: "bg-[var(--status-warning-light)]",
    text: "text-[var(--status-warning-text)]",
  },
  stale: {
    border: "border-[var(--status-warning-border)]",
    bg: "bg-[var(--status-warning-light)]",
    text: "text-[var(--status-warning-text)]",
  },
  info: {
    border: "border-[var(--status-info-border)]",
    bg: "bg-[var(--status-info-light)]",
    text: "text-[var(--status-info-text)]",
  },
}

function getBannerContent(variant: BannerVariant, staleCount: number): React.ReactNode {
  switch (variant) {
    case "tainted":
      return (
        <span>
          A session with extracted signals was deleted — regenerate to remove
          its data from the master signal.
          {staleCount > 0 && (
            <>
              {" "}Additionally, <strong>{staleCount}</strong> new/updated
              session{staleCount === 1 ? "" : "s"} since last generation.
            </>
          )}
        </span>
      )
    case "stale":
      return (
        <span>
          Master signal may be out of date — <strong>{staleCount}</strong>{" "}
          new/updated session{staleCount === 1 ? "" : "s"} since last
          generation.
        </span>
      )
    case "info":
      return (
        <span>Only team admins can generate or regenerate the master signal.</span>
      )
  }
}

export function MasterSignalStatusBanner({
  variant,
  staleCount = 0,
}: MasterSignalStatusBannerProps) {
  const styles = VARIANT_STYLES[variant]
  const Icon = variant === "info" ? Info : AlertTriangle

  return (
    <div className={cn("flex items-center gap-2 rounded-lg border px-4 py-3 text-sm", styles.border, styles.bg, styles.text)}>
      <Icon className="size-4 shrink-0" />
      {getBannerContent(variant, staleCount)}
    </div>
  )
}
