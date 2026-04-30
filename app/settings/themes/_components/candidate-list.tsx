"use client";

import { Button } from "@/components/ui/button";
import type { ThemeCandidateWithThemes } from "@/lib/types/theme-candidate";

import { CandidateRow } from "./candidate-row";

interface CandidateListProps {
  candidates: ThemeCandidateWithThemes[];
  hasMore: boolean;
  onShowMore: () => void;
  onCandidateDismissed: () => void;
}

/**
 * Renders the candidate set + the bounded "Show more" affordance (P2.R4).
 * Empty state and loading state live in the parent so the list itself stays
 * a pure presentation component.
 */
export function CandidateList({
  candidates,
  hasMore,
  onShowMore,
  onCandidateDismissed,
}: CandidateListProps) {
  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <CandidateRow
          key={candidate.id}
          candidate={candidate}
          onDismissed={onCandidateDismissed}
        />
      ))}

      {hasMore && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" size="sm" onClick={onShowMore}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
