"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RefreshButtonProps {
  onClick: () => void;
  isRefreshing: boolean;
  disabled?: boolean;
}

/**
 * Manual refresh trigger. The actual POST + state management lives in
 * `themes-page-content.tsx` (so the auto-refresh-on-stale path and the
 * manual path share one code path). This component is presentation only.
 */
export function RefreshButton({
  onClick,
  isRefreshing,
  disabled,
}: RefreshButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={isRefreshing || disabled}
    >
      <RefreshCw
        className={cn("size-3.5", isRefreshing && "animate-spin")}
        aria-hidden
      />
      {isRefreshing ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
