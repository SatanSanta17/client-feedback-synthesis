"use client";

import { ChevronDown, ChevronRight, RotateCcw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils/format-relative-time";
import type { PromptVersion } from "@/lib/services/prompt-service";

interface VersionHistoryPanelProps {
  history: PromptVersion[];
  isOpen: boolean;
  onToggle: () => void;
  onViewVersion: (version: PromptVersion, versionNumber: number) => void;
  onRevert: (version: PromptVersion) => void;
  isReverting: boolean;
  className?: string;
}

export function VersionHistoryPanel({
  history,
  isOpen,
  onToggle,
  onViewVersion,
  onRevert,
  isReverting,
  className,
}: VersionHistoryPanelProps) {
  const totalVersions = history.length;

  return (
    <div
      className={cn(
        "rounded-md border border-[var(--border-default)]",
        className
      )}
    >
      {/* Toggle header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-raised)] transition-colors rounded-md"
      >
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
        ) : (
          <ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
        )}
        Version History
        <span className="text-xs text-[var(--text-muted)]">
          ({totalVersions} {totalVersions === 1 ? "version" : "versions"})
        </span>
      </button>

      {/* History list */}
      {isOpen && (
        <div className="max-h-72 overflow-y-auto border-t border-[var(--border-default)]">
          {history.length === 0 ? (
            <p className="px-4 py-3 text-sm text-[var(--text-muted)]">
              No version history available.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-default)]">
              {history.map((version, index) => {
                const versionNumber = totalVersions - index;
                const preview =
                  version.content.length > 100
                    ? version.content.slice(0, 100) + "..."
                    : version.content;

                return (
                  <li
                    key={version.id}
                    className={cn(
                      "px-4 py-3",
                      version.is_active && "bg-[var(--brand-primary-light)]"
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Left: version info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-[var(--text-primary)]">
                            v{versionNumber}
                          </span>
                          {version.is_active && (
                            <Badge
                              variant="default"
                              className="text-[10px] px-1.5 py-0"
                            >
                              Active
                            </Badge>
                          )}
                          <span className="text-xs text-[var(--text-muted)]">
                            {formatRelativeTime(version.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                          {version.author_email}
                        </p>
                        <p className="mt-1 truncate text-xs text-[var(--text-muted)] font-mono">
                          {preview}
                        </p>
                      </div>

                      {/* Right: actions */}
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => onViewVersion(version, versionNumber)}
                        >
                          <Eye className="mr-1 h-3 w-3" />
                          View
                        </Button>
                        {!version.is_active && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => onRevert(version)}
                            disabled={isReverting}
                          >
                            <RotateCcw className="mr-1 h-3 w-3" />
                            Revert
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
