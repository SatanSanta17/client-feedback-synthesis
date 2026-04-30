"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { pluralize } from "@/lib/utils/plural";
import type { ThemeCandidateWithThemes } from "@/lib/types/theme-candidate";
import type { MergeResult } from "@/lib/types/theme-merge";

interface MergeDialogProps {
  /** When non-null, dialog is open. Setting to null closes it. */
  candidate: ThemeCandidateWithThemes | null;
  onCancel: () => void;
  onConfirmed: (result: MergeResult) => void;
}

/**
 * Confirmation dialog for theme merges (PRD-026 P3.R2 / P3.R3 / P3.R8).
 *
 * - Canonical-flip radio defaults to the higher-volume side of the pair.
 * - Blast-radius preview is computed from the candidate's snapshot stats
 *   (TRD Decision 27) — no extra round trip; "approximately N signals"
 *   wording covers the snapshot's max-24h staleness.
 * - Confirms the chat-history-preserved disclaimer literally.
 * - Owns the POST + loading state; on failure shows a toast and keeps the
 *   dialog open so the admin can retry or cancel.
 */
export function MergeDialog({
  candidate,
  onCancel,
  onConfirmed,
}: MergeDialogProps) {
  const open = candidate !== null;

  // Default canonical = higher-volume side. Recompute every time the
  // candidate identity changes (a different row was clicked).
  const defaultCanonicalId = candidate
    ? candidate.themeAStats.assignmentCount >=
      candidate.themeBStats.assignmentCount
      ? candidate.themeAId
      : candidate.themeBId
    : null;

  const [canonicalThemeId, setCanonicalThemeId] = useState<string | null>(
    defaultCanonicalId
  );
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    setCanonicalThemeId(defaultCanonicalId);
    setIsPending(false);
  }, [defaultCanonicalId]);

  if (!candidate) return null;

  const sideA = {
    id: candidate.themeAId,
    name: candidate.themeA.name,
    description: candidate.themeA.description,
    stats: candidate.themeAStats,
  };
  const sideB = {
    id: candidate.themeBId,
    name: candidate.themeB.name,
    description: candidate.themeB.description,
    stats: candidate.themeBStats,
  };

  const archivedSide =
    canonicalThemeId === sideA.id ? sideB : sideA;
  const canonicalSide =
    canonicalThemeId === sideA.id ? sideA : sideB;

  async function handleConfirm() {
    if (!canonicalThemeId || !candidate) return;
    setIsPending(true);
    try {
      const res = await fetch(
        `/api/themes/candidates/${candidate.id}/merge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canonicalThemeId }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Merge failed (${res.status})`);
      }
      const result = (await res.json()) as MergeResult;
      onConfirmed(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Merge failed";
      toast.error(message);
      setIsPending(false);
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next && !isPending) onCancel();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge themes</DialogTitle>
          <DialogDescription>
            Pick the theme to keep as canonical. The other theme will be
            archived and its signals will be re-pointed to the canonical
            theme.
          </DialogDescription>
        </DialogHeader>

        <fieldset
          className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2"
          disabled={isPending}
        >
          <legend className="sr-only">Choose canonical theme</legend>
          <CanonicalChoice
            label="Keep this theme"
            side={sideA}
            checked={canonicalThemeId === sideA.id}
            onSelect={() => setCanonicalThemeId(sideA.id)}
          />
          <CanonicalChoice
            label="Keep this theme"
            side={sideB}
            checked={canonicalThemeId === sideB.id}
            onSelect={() => setCanonicalThemeId(sideB.id)}
          />
        </fieldset>

        <BlastRadiusPreview
          archived={archivedSide}
          canonical={canonicalSide}
        />

        <p className="mt-3 text-xs text-[var(--text-muted)]">
          Past chat messages won&rsquo;t be rewritten — only future chat
          queries will use the canonical name. Dashboard widgets switch over
          immediately.
        </p>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleConfirm}
            disabled={isPending || !canonicalThemeId}
          >
            {isPending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface SideShape {
  id: string;
  name: string;
  description: string | null;
  stats: ThemeCandidateWithThemes["themeAStats"];
}

interface CanonicalChoiceProps {
  label: string;
  side: SideShape;
  checked: boolean;
  onSelect: () => void;
}

function CanonicalChoice({
  label,
  side,
  checked,
  onSelect,
}: CanonicalChoiceProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer flex-col gap-2 rounded-lg border p-3 transition-colors",
        checked
          ? "border-[var(--brand-primary)] bg-[var(--brand-primary-light)]"
          : "border-[var(--border-default)] bg-[var(--surface-raised)] hover:bg-muted"
      )}
    >
      <span className="flex items-center gap-2">
        <input
          type="radio"
          name="canonical"
          className="size-4"
          checked={checked}
          onChange={onSelect}
          aria-label={`${label} — ${side.name}`}
        />
        <span className="text-sm font-semibold text-[var(--text-primary)]">
          {side.name}
        </span>
      </span>
      {side.description ? (
        <span className="text-sm text-[var(--text-secondary)] line-clamp-2">
          {side.description}
        </span>
      ) : (
        <span className="text-sm italic text-[var(--text-muted)]">
          No description
        </span>
      )}
      <span className="text-xs text-[var(--text-secondary)]">
        {side.stats.assignmentCount}{" "}
        {pluralize("signal", side.stats.assignmentCount)} ·{" "}
        {side.stats.distinctSessions}{" "}
        {pluralize("session", side.stats.distinctSessions)} ·{" "}
        {side.stats.distinctClients}{" "}
        {pluralize("client", side.stats.distinctClients)}
      </span>
    </label>
  );
}

function BlastRadiusPreview({
  archived,
  canonical,
}: {
  archived: SideShape;
  canonical: SideShape;
}) {
  return (
    <div className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-3">
      <p className="text-sm text-[var(--text-primary)]">
        <strong>{archived.name}</strong> will be archived and its signals
        re-pointed to <strong>{canonical.name}</strong>.
      </p>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        Approximately {archived.stats.assignmentCount}{" "}
        {pluralize("signal assignment", archived.stats.assignmentCount)} will
        be re-pointed across {archived.stats.distinctSessions}{" "}
        {pluralize("session", archived.stats.distinctSessions)} and{" "}
        {archived.stats.distinctClients}{" "}
        {pluralize("client", archived.stats.distinctClients)}.
      </p>
    </div>
  );
}
