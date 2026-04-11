"use client";

// ---------------------------------------------------------------------------
// MessageStatusIndicator — Status badges + retry (PRD-020 Part 3, 3.4)
// ---------------------------------------------------------------------------
// Renders visual indicators for non-completed message statuses:
// - failed: red badge + "Retry" button
// - cancelled: amber badge + "Retry" button
// - stale streaming: grey badge + "Retry" button
// Only shown on the latest assistant message.
// ---------------------------------------------------------------------------

import { AlertCircle, RotateCcw, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { MessageStatus } from "@/lib/types/chat";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface MessageStatusIndicatorProps {
  status: MessageStatus;
  /** Whether this message can be retried (latest assistant with terminal status). */
  canRetry: boolean;
  /** Retry handler — re-sends the preceding user message. */
  onRetry?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: typeof AlertCircle; className: string }
> = {
  failed: {
    label: "Failed to generate",
    icon: AlertCircle,
    className: "text-destructive",
  },
  cancelled: {
    label: "Generation stopped",
    icon: XCircle,
    className: "text-amber-600 dark:text-amber-500",
  },
  streaming: {
    label: "Generation interrupted",
    icon: AlertCircle,
    className: "text-muted-foreground",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MessageStatusIndicator({
  status,
  canRetry,
  onRetry,
  className,
}: MessageStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];

  // Only render for non-completed statuses that have a config
  if (!config) return null;

  const Icon = config.icon;

  return (
    <div className={cn("mt-2 flex items-center gap-2", className)}>
      <div className={cn("flex items-center gap-1 text-xs", config.className)}>
        <Icon className="size-3.5" />
        <span>{config.label}</span>
      </div>

      {canRetry && onRetry && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onRetry}
          className="h-6 gap-1 px-2 text-xs"
        >
          <RotateCcw className="size-3" />
          Retry
        </Button>
      )}
    </div>
  );
}
