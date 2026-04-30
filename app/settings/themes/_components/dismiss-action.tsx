"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface DismissActionProps {
  candidateId: string;
  onDismissed: () => void;
}

/**
 * Per-row dismiss button. Records the admin's "not a duplicate" judgment
 * via POST /api/themes/candidates/[id]/dismiss; the parent re-fetches the
 * list so the row leaves the surface without a full page reload (P3.R8 in
 * spirit, applied to dismiss in Part 2).
 */
export function DismissAction({ candidateId, onDismissed }: DismissActionProps) {
  const [isPending, setIsPending] = useState(false);

  async function handleDismiss() {
    setIsPending(true);
    try {
      const res = await fetch(
        `/api/themes/candidates/${candidateId}/dismiss`,
        { method: "POST" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Dismiss failed (${res.status})`);
      }
      toast.success("Pair dismissed");
      onDismissed();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Dismiss failed";
      toast.error(message);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDismiss}
      disabled={isPending}
    >
      {isPending ? "Dismissing…" : "Dismiss"}
    </Button>
  );
}
