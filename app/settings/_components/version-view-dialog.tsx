"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { RotateCcw } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils/format-relative-time";
import type { PromptVersion } from "@/lib/services/prompt-service";

interface VersionViewDialogProps {
  version: PromptVersion | null;
  versionNumber: number;
  onClose: () => void;
  onRevert?: (version: PromptVersion) => void;
  isReverting: boolean;
}

export function VersionViewDialog({
  version,
  versionNumber,
  onClose,
  onRevert,
  isReverting,
}: VersionViewDialogProps) {
  if (!version) return null;

  return (
    <Dialog
      open={version !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Version {versionNumber}</span>
            {version.is_active && (
              <Badge
                variant="default"
                className="text-[10px] px-1.5 py-0"
              >
                Active
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 text-xs">
            <span>{version.author_email}</span>
            <span className="text-[var(--text-muted)]">·</span>
            <span>{formatRelativeTime(version.created_at)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden">
          <textarea
            readOnly
            value={version.content}
            className="h-full min-h-[70vh] w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--surface-raised)] p-4 font-mono text-sm leading-relaxed text-[var(--text-primary)] focus:outline-none"
            spellCheck={false}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!version.is_active && onRevert && (
            <Button
              variant="outline"
              onClick={() => onRevert(version)}
              disabled={isReverting}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {isReverting ? "Reverting..." : "Revert to this version"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
