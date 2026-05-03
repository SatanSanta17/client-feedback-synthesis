"use client";

import { cn } from "@/lib/utils";
import type {
  ExtractedSignals,
  SignalChunk,
  RequirementChunk,
  CompetitiveMention,
  ToolAndPlatform,
  CustomCategory,
} from "@/lib/schemas/extraction-schema";

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export interface StructuredSignalViewProps {
  signals: ExtractedSignals;
  className?: string;
}

/**
 * Renders an ExtractedSignals object as formatted UI with discrete sections,
 * severity badges, quote formatting, and empty-state handling.
 * Replaces the ReactMarkdown rendering of structured_notes for sessions
 * that have structured_json (PRD-018 P2.R3).
 *
 * PRD-031 Part 2:
 * - New "Positive Signals" section (success-themed severity badge), positioned
 *   in the current-state cluster between Pain Points and Must-Haves.
 * - Empty narrative sections are hidden entirely instead of rendering a
 *   "No signals identified." placeholder row (P2.R6). Always-visible sections
 *   (Session Summary, Sentiment, Urgency, Decision Timeline, Client Profile)
 *   are unchanged — they keep their own "Not mentioned" treatment for null
 *   fields.
 * - Defensive `?? []` access on `positiveSignals` because legacy v1 rows
 *   read via raw cast may lack the field at runtime even though the inferred
 *   type marks it as required.
 */
export function StructuredSignalView({
  signals,
  className,
}: StructuredSignalViewProps) {
  const positiveSignals = signals.positiveSignals ?? [];

  return (
    <div className={cn("space-y-6", className)}>
      {/* --- Session Overview --- */}
      <Section title="Session Summary">
        <p className="text-sm text-foreground">{signals.summary}</p>
      </Section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Section title="Sentiment">
          <SentimentBadge sentiment={signals.sentiment} />
        </Section>

        <Section title="Urgency">
          <UrgencyBadge urgency={signals.urgency} />
        </Section>

        <Section title="Decision Timeline">
          <NullableText value={signals.decisionTimeline} />
        </Section>
      </div>

      {/* --- Client Profile --- */}
      <Section title="Client Profile">
        <div className="space-y-1 text-sm">
          <ProfileField label="Industry / Vertical" value={signals.clientProfile.industry} />
          <ProfileField label="Market / Geography" value={signals.clientProfile.geography} />
          <ProfileField label="Budget / Spend" value={signals.clientProfile.budgetRange} />
        </div>
      </Section>

      {/* --- Signal Categories (P2.R6: each gated on length > 0) --- */}
      {signals.painPoints.length > 0 && (
        <Section title="Pain Points">
          <SignalChunkList chunks={signals.painPoints} />
        </Section>
      )}

      {positiveSignals.length > 0 && (
        <Section title="Positive Signals">
          <SignalChunkList chunks={positiveSignals} severityVariant="positive" />
        </Section>
      )}

      {signals.requirements.length > 0 && (
        <Section title="Must-Haves / Requirements">
          <RequirementChunkList chunks={signals.requirements} />
        </Section>
      )}

      {signals.aspirations.length > 0 && (
        <Section title="Aspirations">
          <SignalChunkList chunks={signals.aspirations} />
        </Section>
      )}

      {signals.competitiveMentions.length > 0 && (
        <Section title="Competitive Mentions">
          <CompetitiveMentionList mentions={signals.competitiveMentions} />
        </Section>
      )}

      {signals.blockers.length > 0 && (
        <Section title="Blockers / Dependencies">
          <SignalChunkList chunks={signals.blockers} />
        </Section>
      )}

      {signals.toolsAndPlatforms.length > 0 && (
        <Section title="Platforms & Channels">
          <ToolAndPlatformList tools={signals.toolsAndPlatforms} />
        </Section>
      )}

      {/* --- Custom Categories (P2.R6: each category gated on length > 0) --- */}
      {signals.custom
        .filter((category: CustomCategory) => category.signals.length > 0)
        .map((category: CustomCategory, i: number) => (
          <Section key={i} title={category.categoryName}>
            <SignalChunkList chunks={category.signals} />
          </Section>
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

function NullableText({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-sm text-muted-foreground">Not mentioned</span>;
  }
  return <span className="text-sm text-foreground">{value}</span>;
}

function ProfileField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-1.5">
      <span className="font-medium text-muted-foreground">{label}:</span>
      <NullableText value={value} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signal chunk lists
//
// PRD-031 Part 2: empty-array guards removed — the parent gates each section
// on length > 0 before rendering, so list components never receive empty
// arrays. The previous EmptyState component is dead and was deleted.
// ---------------------------------------------------------------------------

type SeverityVariant = "default" | "positive";

function SignalChunkList({
  chunks,
  severityVariant = "default",
}: {
  chunks: SignalChunk[];
  severityVariant?: SeverityVariant;
}) {
  return (
    <ul className="space-y-2">
      {chunks.map((chunk, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start justify-between gap-2">
            <span className="text-foreground">{chunk.text}</span>
            <SeverityBadge severity={chunk.severity} variant={severityVariant} />
          </div>
          <ClientQuote quote={chunk.clientQuote} />
        </li>
      ))}
    </ul>
  );
}

function RequirementChunkList({ chunks }: { chunks: RequirementChunk[] }) {
  return (
    <ul className="space-y-2">
      {chunks.map((chunk, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start gap-2">
            <PriorityBadge priority={chunk.priority} />
            <div className="flex-1">
              <div className="flex items-start justify-between gap-2">
                <span className="text-foreground">{chunk.text}</span>
                <SeverityBadge severity={chunk.severity} />
              </div>
              <ClientQuote quote={chunk.clientQuote} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function CompetitiveMentionList({ mentions }: { mentions: CompetitiveMention[] }) {
  return (
    <ul className="space-y-2">
      {mentions.map((m, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start gap-2">
            <span className="font-medium text-foreground">{m.competitor}</span>
            <SentimentBadge sentiment={m.sentiment} />
          </div>
          <p className="mt-0.5 text-muted-foreground">{m.context}</p>
        </li>
      ))}
    </ul>
  );
}

function ToolAndPlatformList({ tools }: { tools: ToolAndPlatform[] }) {
  return (
    <ul className="space-y-2">
      {tools.map((t, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start gap-2">
            <span className="font-medium text-foreground">{t.name}</span>
            <span className="inline-flex shrink-0 items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {t.type}
            </span>
          </div>
          <p className="mt-0.5 text-muted-foreground">{t.context}</p>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Shared inline helpers
// ---------------------------------------------------------------------------

function ClientQuote({ quote }: { quote: string | null }) {
  if (!quote) return null;
  return (
    <p className="mt-0.5 text-xs italic text-muted-foreground">
      &ldquo;{quote}&rdquo;
    </p>
  );
}

// ---------------------------------------------------------------------------
// Badge components
// ---------------------------------------------------------------------------

// PRD-031 Part 2: severity badge gains a `variant` prop. The `positive` variant
// reuses the existing `--status-success-*` token chain (same tokens used by the
// positive SentimentBadge), so a positive_signal item's "high" intensity reads
// as a strong-green pill instead of a strong-red one.
const SEVERITY_STYLE_MAPS: Record<SeverityVariant, Record<"low" | "medium" | "high", string>> = {
  default: {
    low: "bg-muted text-muted-foreground",
    medium:
      "bg-[var(--status-warning-light)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]",
    high: "bg-[var(--status-error-light)] text-[var(--status-error)] border border-[var(--status-error-border)]",
  },
  positive: {
    low: "bg-muted text-muted-foreground",
    medium:
      "bg-[var(--status-success-light)] text-[var(--status-success)] border border-[var(--status-success-border)] opacity-80",
    high: "bg-[var(--status-success-light)] text-[var(--status-success)] border border-[var(--status-success-border)]",
  },
};

function SeverityBadge({
  severity,
  variant = "default",
}: {
  severity: "low" | "medium" | "high";
  variant?: SeverityVariant;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        SEVERITY_STYLE_MAPS[variant][severity]
      )}
    >
      {severity}
    </span>
  );
}

const PRIORITY_STYLES: Record<"must" | "should" | "nice", string> = {
  must: "bg-[var(--status-error-light)] text-[var(--status-error)] border border-[var(--status-error-border)]",
  should:
    "bg-[var(--status-warning-light)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]",
  nice: "bg-muted text-muted-foreground",
};

const PRIORITY_LABELS: Record<"must" | "should" | "nice", string> = {
  must: "Must",
  should: "Should",
  nice: "Nice",
};

function PriorityBadge({ priority }: { priority: "must" | "should" | "nice" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        PRIORITY_STYLES[priority]
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

const SENTIMENT_STYLES: Record<
  "positive" | "neutral" | "negative" | "mixed",
  string
> = {
  positive:
    "bg-[var(--status-success-light)] text-[var(--status-success)] border border-[var(--status-success-border)]",
  neutral: "bg-muted text-muted-foreground",
  negative:
    "bg-[var(--status-error-light)] text-[var(--status-error)] border border-[var(--status-error-border)]",
  mixed:
    "bg-[var(--status-warning-light)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]",
};

const SENTIMENT_LABELS: Record<
  "positive" | "neutral" | "negative" | "mixed",
  string
> = {
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  mixed: "Mixed",
};

function SentimentBadge({
  sentiment,
}: {
  sentiment: "positive" | "neutral" | "negative" | "mixed";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        SENTIMENT_STYLES[sentiment]
      )}
    >
      {SENTIMENT_LABELS[sentiment]}
    </span>
  );
}

const URGENCY_STYLES: Record<
  "low" | "medium" | "high" | "critical",
  string
> = {
  low: "bg-muted text-muted-foreground",
  medium:
    "bg-[var(--status-warning-light)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]",
  high: "bg-[var(--status-error-light)] text-[var(--status-error)] border border-[var(--status-error-border)]",
  critical:
    "bg-[var(--status-error)] text-primary-foreground border border-[var(--status-error)]",
};

const URGENCY_LABELS: Record<
  "low" | "medium" | "high" | "critical",
  string
> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function UrgencyBadge({
  urgency,
}: {
  urgency: "low" | "medium" | "high" | "critical";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        URGENCY_STYLES[urgency]
      )}
    >
      {URGENCY_LABELS[urgency]}
    </span>
  );
}
