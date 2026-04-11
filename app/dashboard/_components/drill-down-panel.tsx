"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DrillDownContent } from "./drill-down-content";
import type { DrillDownContext } from "./drill-down-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DrillDownPanelProps {
  /** Non-null = open the panel with this context. Null = closed. */
  context: DrillDownContext | null;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// DrillDownPanel
// ---------------------------------------------------------------------------
// Thin shell — wraps DrillDownContent inside a Sheet (side="right").
// This file is the single swap point if the Sheet approach doesn't work.
// Replace Sheet/SheetContent with Dialog/DialogContent and adjust width.
// DrillDownContent, all widget wiring, and the API layer stay untouched.
// ---------------------------------------------------------------------------

export function DrillDownPanel({ context, onClose }: DrillDownPanelProps) {
  // Placeholder for session preview — will be wired in increment 4.3
  const handleViewSession = (_sessionId: string) => {
    // TODO (4.3): Open SessionPreviewDialog with _sessionId
  };

  return (
    <Sheet open={context !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full sm:w-[45vw] sm:min-w-[400px] sm:max-w-[700px] overflow-y-auto"
      >
        <SheetHeader>
          <SheetTitle>Signal Drill-Down</SheetTitle>
          <SheetDescription>
            Signals matching the selected data point
          </SheetDescription>
        </SheetHeader>

        {context && (
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <DrillDownContent
              context={context}
              onViewSession={handleViewSession}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
