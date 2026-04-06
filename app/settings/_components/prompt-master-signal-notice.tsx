"use client"

import type { PromptKey } from "@/lib/services/prompt-service"

interface PromptMasterSignalNoticeProps {
  displayedMasterKey: PromptKey
  autoSelectedMasterKey: PromptKey
  onToggle: () => void
  disabled: boolean
}

export function PromptMasterSignalNotice({
  displayedMasterKey,
  autoSelectedMasterKey,
  onToggle,
  disabled,
}: PromptMasterSignalNoticeProps) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <p>
        {displayedMasterKey === "master_signal_incremental" ? (
          <>
            Editing the{" "}
            <strong className="text-foreground">incremental</strong>{" "}
            prompt — used when updating an existing master signal with
            new/updated sessions.
          </>
        ) : (
          <>
            Editing the{" "}
            <strong className="text-foreground">cold-start</strong>{" "}
            prompt — used when no master signal exists yet or after a
            session with signals is deleted.
          </>
        )}
        {displayedMasterKey === autoSelectedMasterKey && (
          <span className="ml-1.5 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
            active
          </span>
        )}
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        className="shrink-0 text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
      >
        {displayedMasterKey === "master_signal_incremental"
          ? "View cold-start prompt"
          : "View incremental prompt"}
      </button>
    </div>
  )
}
