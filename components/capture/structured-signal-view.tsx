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
 */
export function StructuredSignalView({
  signals,
  className,
}: StructuredSignalViewProps) {
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

      {/* --- Signal Categories --- */}
      <Section title="Pain Points">
        <SignalChunkList chunks={signals.painPoints} />
      </Section>

      <Section title="Must-Haves / Requirements">
        <RequirementChunkList chunks={signals.requirements} />
      </Section>

      <Section title="Aspirations">
        <SignalChunkList chunks={signals.aspirations} />
      </Section>

      <Section title="Competitive Mentions">
        <CompetitiveMentionList mentions={signals.competitiveMentions} />
      </Section>

      <Section title="Blockers / Dependencies">
        <SignalChunkList chunks={signals.blockers} />
      </Section>

      <Section title="Platforms & Channels">
        <ToolAndPlatformList tools={signals.toolsAndPlatforms} />
      </Section>

      {/* --- Custom Categories --- */}
      {signals.custom.length > 0 &&
        signals.custom.map((category: CustomCategory, i: number) => (
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

function EmptyState() {
  return (
    <p className="text-sm text-muted-foreground">No signals identified.</p>
  );
}

// ---------------------------------------------------------------------------
// Signal chunk lists
// ---------------------------------------------------------------------------

function SignalChunkList({ chunks }: { chunks: SignalChunk[] }) {
  if (chunks.length === 0) return <EmptyState />;

  return (
    <ul className="space-y-2">
      {chunks.map((chunk, i) => (
        <li key={i} className="text-sm">
          <div className="flex items-start justify-between gap-2">
            <span className="text-foreground">{chunk.text}</span>
            <SeverityBadge severity={chunk.severity} />
          </div>
          <ClientQuote quote={chunk.clientQuote} />
        </li>
      ))}
    </ul>
  );
}

function RequirementChunkList({ chunks }: { chunks: RequirementChunk[] }) {
  if (chunks.length === 0) return <EmptyState />;

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
  if (mentions.length === 0) return <EmptyState />;

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
  if (tools.length === 0) return <EmptyState />;

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

const SEVERITY_STYLES: Record<"low" | "medium" | "high", string> = {
  low: "bg-muted text-muted-foreground",
  medium:
    "bg-[var(--status-warning-light)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)]",
  high: "bg-[var(--status-error-light)] text-[var(--status-error)] border border-[var(--status-error-border)]",
};

function SeverityBadge({ severity }: { severity: "low" | "medium" | "high" }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
        SEVERITY_STYLES[severity]
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
    "bg-[var(--status-error)] text-white border border-[var(--status-error)]",
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
