"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ThemeCandidateWithThemes } from "@/lib/types/theme-candidate";

import { DismissAction } from "./dismiss-action";

interface CandidateRowProps {
  candidate: ThemeCandidateWithThemes;
  onDismissed: () => void;
}

/**
 * Renders a single candidate pair per P2.R3:
 *   - Both theme names + descriptions
 *   - Confidence pill (similarity %)
 *   - Per-side stats (assignments / sessions / clients)
 *   - Shared-keywords hint (when present)
 *   - Dismiss action; "Merge" placeholder reserved for Part 3
 */
export function CandidateRow({ candidate, onDismissed }: CandidateRowProps) {
  const { themeA, themeB, themeAStats, themeBStats, sharedKeywords } = candidate;

  return (
    <article className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 sm:p-5">
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

      <footer className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] pt-3">
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-label="Merge — coming in Part 3"
          title="Coming soon"
        >
          Merge…
        </Button>
        <DismissAction
          candidateId={candidate.id}
          onDismissed={onDismissed}
        />
      </footer>

      <p className="mt-2 text-[11px] uppercase tracking-wide text-[var(--text-tertiary)]">
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
 * 0.85–0.92 moderate, <0.85 looser. Tailwind utility classes are kept here
 * so a future design-token migration is one file to update.
 */
function pillClassFor(score: number): string {
  if (score >= 0.92) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  }
  if (score >= 0.85) {
    return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
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
        <p className="text-sm italic text-[var(--text-tertiary)]">
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
