"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ThemeCandidateWithThemes } from "@/lib/types/theme-candidate";

import { DismissAction } from "./dismiss-action";

interface CandidateRowProps {
  candidate: ThemeCandidateWithThemes;
  onDismissed: () => void;
  onMerge: (candidate: ThemeCandidateWithThemes) => void;
}

/**
 * Renders a single candidate pair per P2.R3:
 *   - Both theme names + descriptions
 *   - Confidence pill (similarity %)
 *   - Per-side stats (assignments / sessions / clients)
 *   - Shared-keywords hint (when present)
 *   - Dismiss action; "Merge" placeholder reserved for Part 3
 */
export function CandidateRow({
  candidate,
  onDismissed,
  onMerge,
}: CandidateRowProps) {
  const { themeA, themeB, themeAStats, themeBStats, sharedKeywords } = candidate;

  return (
    <article className="rounded-lg border border-[var(--border-default)] bg-[var(--surface-raised)] p-4 sm:p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <SimilarityPill score={candidate.similarityScore} />
        {sharedKeywords.length > 0 && (
          <p className="text-xs text-[var(--text-secondary)]">
            <span className="font-medium">Shared:</span>{" "}
            {sharedKeywords.join(", ")}
          </p>
        )}
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <ThemeSide
          name={themeA.name}
          description={themeA.description}
          stats={themeAStats}
        />
        <ThemeSide
          name={themeB.name}
          description={themeB.description}
          stats={themeBStats}
        />
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-default)] pt-3">
        <Button
          variant="default"
          size="sm"
          onClick={() => onMerge(candidate)}
        >
          Merge…
        </Button>
        <DismissAction
          candidateId={candidate.id}
          onDismissed={onDismissed}
        />
      </footer>

      <p className="mt-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
        {`Similarity ${candidate.similarityScore.toFixed(3)} · volume ${candidate.volumeScore.toFixed(2)} · recency ${candidate.recencyScore.toFixed(2)}`}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SimilarityPill({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  return (
    <Badge
      variant="secondary"
      className={cn("font-medium", pillClassFor(score))}
    >
      {pct}% match
    </Badge>
  );
}

/**
 * Tier mapping mirrors the bands referenced in the TRD: ≥0.92 strong,
 * 0.85–0.92 moderate, <0.85 looser. Reuses the project-wide status tokens
 * (matching `structured-signal-view.tsx` and the dashboard insight cards)
 * so a global theme tweak flows through here automatically.
 */
function pillClassFor(score: number): string {
  if (score >= 0.92) {
    return "bg-[var(--status-success-light)] text-[var(--status-success)] border border-[var(--status-success-border)]";
  }
  if (score >= 0.85) {
    return "bg-[var(--status-warning-light)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]";
  }
  return "bg-muted text-muted-foreground";
}

interface ThemeSideProps {
  name: string;
  description: string | null;
  stats: ThemeCandidateWithThemes["themeAStats"];
}

function ThemeSide({ name, description, stats }: ThemeSideProps) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
        {name}
      </h3>
      {description ? (
        <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
          {description}
        </p>
      ) : (
        <p className="text-sm italic text-[var(--text-muted)]">
          No description
        </p>
      )}
      <p className="text-xs text-[var(--text-secondary)]">
        {`${stats.assignmentCount} ${plural("signal", stats.assignmentCount)} · `}
        {`${stats.distinctSessions} ${plural("session", stats.distinctSessions)} · `}
        {`${stats.distinctClients} ${plural("client", stats.distinctClients)}`}
      </p>
    </div>
  );
}

function plural(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
