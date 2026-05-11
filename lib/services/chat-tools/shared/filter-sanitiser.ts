// ---------------------------------------------------------------------------
// Tool Filter Sanitiser — provider-agnostic defence against schema-fill
// hallucination on tool inputs.
//
// CONTEXT (post-PRD-033 deviation, recorded 2026-05-11):
// PRD-033 retired the monolithic sanitisation layer in chat-stream-service.ts
// on the assumption that per-tool Zod schemas + strong "OMIT unless..." tool
// descriptions would prevent the model from inventing filter values. That
// assumption held for Claude but not for GPT-4o, which invents categorical
// enum values (sentiment, severity, urgency) and passes empty strings for
// every optional field even when the user's prompt has zero filter intent.
//
// THIS MODULE re-introduces the safety net — but per-tool and provider-
// agnostic instead of the old monolithic "sanitize<Tool>Filters" pair. Each
// tool's `execute()` calls the matching sanitiser before invoking its
// service. The sanitiser drops:
//   1. Empty strings / empty arrays for any optional field.
//   2. Categorical filters (sentiment, severity, urgency, granularity,
//      confidenceMin) whose values are not justified by a cue in the user's
//      most recent message.
//   3. Free-text filters (clientName, themeName, nameSearch) whose values
//      don't appear textually in the user's most recent message.
//   4. Date filters when the message has no date cue.
//
// Trade-off: false-positives possible (e.g., the model resolves "PT Power" →
// "PrudenTech Power" and we drop the legitimate filter because the literal
// resolved name isn't in the message). For categorical filters this risk is
// very low; for free-text filters it's the dominant failure mode the old
// surface accepted too. The fix is provider-agnostic — works regardless of
// whether the active model is Claude, GPT, Gemini, etc.
// ---------------------------------------------------------------------------

import type { ChunkType } from "@/lib/types/embedding-chunk";

const LOG_PREFIX = "[filter-sanitiser]";

// ---------------------------------------------------------------------------
// Cue dictionaries — keywords that, when present in the user's message,
// justify a corresponding filter value.
// ---------------------------------------------------------------------------

// Field-discriminator cues only. The bare values "low", "medium", "high" are
// deliberately NOT cues here — they overlap across severity and urgency, so
// if the user says "high-severity items" and the model invents an
// `urgency=high` filter, the bare-value match would let the invented filter
// through. Requiring the field name (or a value unique to one field, like
// "critical" for urgency) eliminates the cross-family bleed.
const SEVERITY_CUES = ["severity", "severe"];

const URGENCY_CUES = ["urgency", "urgent", "critical"];

const SENTIMENT_CUES = [
  "sentiment",
  "positive",
  "negative",
  "neutral",
  "mixed",
  "feel",
  "feeling",
  "tone",
  "mood",
  "happy",
  "unhappy",
  "satisfied",
  "unsatisfied",
];

const GRANULARITY_CUES = [
  "week",
  "month",
  "weekly",
  "monthly",
  "trend",
  "over time",
  "per month",
  "per week",
];

const CONFIDENCE_CUES = ["confidence", "confident"];

const DATE_CUE_REGEX =
  /\b(20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|today|yesterday|recent|since|before|after|between|past|last|this|quarter|year|month|week|day|q1|q2|q3|q4|h1|h2|fy|ytd)\b/i;

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function mentions(haystack: string, cues: string[]): boolean {
  const lower = haystack.toLowerCase();
  return cues.some((c) => lower.includes(c.toLowerCase()));
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Drop a categorical filter (enum value) unless the user's message contains
 * a cue keyword for that filter family.
 *
 * Cues must be field-discriminating: include the field name (`severity`,
 * `urgency`) and values that are unique to this field (e.g. `critical` for
 * urgency). Do NOT include shared values like `low`/`medium`/`high` — they
 * cross-pollinate across severity and urgency, and would let a model-
 * invented `urgency=high` slip through whenever the user said
 * "high-severity".
 *
 * Sentiment is the exception: every sentiment value (`positive`,
 * `negative`, `neutral`, `mixed`) is itself a discriminating word, so
 * `SENTIMENT_CUES` legitimately includes the values.
 */
function keepCategorical<T extends string>(
  value: T | undefined,
  cues: string[],
  userMessage: string
): T | undefined {
  if (!value || !isNonEmptyString(value)) return undefined;
  if (mentions(userMessage, cues)) return value;
  return undefined;
}

/**
 * Drop a free-text filter (like clientName / themeName) unless the value
 * appears in the user's message OR has been resolved earlier in this turn
 * via list_clients / list_themes (the `resolvedNames` set on ChatToolContext).
 *
 * The resolved-set check closes the false-positive case where the model
 * resolves "PT Power" → "PrudenTech Power" via list_clients and then passes
 * the canonical name as a filter — the canonical isn't in the user's
 * message, but it's a legitimate resolution and shouldn't be dropped.
 *
 * Casefold for comparison; whitespace-trim for safety.
 */
function keepIfMentioned(
  value: string | undefined,
  userMessage: string,
  resolvedSet?: Set<string>
): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  const normalised = value.trim().toLowerCase();
  if (userMessage.toLowerCase().includes(normalised)) return value;
  if (resolvedSet) {
    for (const resolved of resolvedSet) {
      if (resolved.trim().toLowerCase() === normalised) return value;
    }
  }
  return undefined;
}

/**
 * Drop a date filter unless the user's message contains a date-shaped cue.
 */
function keepIfDate(
  value: string | undefined,
  userMessage: string
): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return DATE_CUE_REGEX.test(userMessage) ? value : undefined;
}

/**
 * Drop a confidenceMin filter when it's ≤ 0 (no-op) or when the user didn't
 * mention confidence. Defensive against the model passing 0 as a default.
 */
function keepConfidenceMin(
  value: number | undefined,
  userMessage: string
): number | undefined {
  if (value === undefined || value <= 0) return undefined;
  return mentions(userMessage, CONFIDENCE_CUES) ? value : undefined;
}

/**
 * Drop empty arrays unconditionally; otherwise pass through.
 */
function keepIfNonEmptyArray<T>(value: T[] | undefined): T[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value;
}

// ---------------------------------------------------------------------------
// Diff logging — emits one line when sanitisation changes the filter object.
// Gives us observability into how often each model invents which filter.
// ---------------------------------------------------------------------------

function logIfChanged(
  toolName: string,
  raw: unknown,
  kept: unknown
): void {
  if (JSON.stringify(raw) !== JSON.stringify(kept)) {
    console.log(
      `${LOG_PREFIX} ${toolName} — sanitised filters; raw: ${JSON.stringify(raw)}, kept: ${JSON.stringify(kept)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Per-tool sanitisers
//
// Every per-tool sanitiser accepts a `resolvedNames` set populated by prior
// `list_clients` / `list_themes` calls in the same turn. Filter values that
// match a previously-resolved canonical name pass through even if they don't
// appear textually in the user's most recent message. See `keepIfMentioned`
// for the rationale.
// ---------------------------------------------------------------------------

export interface ResolvedNames {
  clients: Set<string>;
  themes: Set<string>;
}

export interface ListClientsRaw {
  nameSearch?: string;
  hasSessions?: boolean;
  limit?: number;
}

export function sanitiseListClients(
  raw: ListClientsRaw,
  userMessage: string
): ListClientsRaw {
  // nameSearch is a free-text substring filter, NOT a resolved canonical
  // name — don't allow it to bypass the message check via resolvedNames.
  const kept: ListClientsRaw = {
    nameSearch: keepIfMentioned(raw.nameSearch, userMessage),
    hasSessions: raw.hasSessions, // boolean — leave alone
    limit: raw.limit,
  };
  logIfChanged("list_clients", raw, kept);
  return kept;
}

export interface ListSessionsRaw {
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  sentiment?: "positive" | "neutral" | "negative";
  themeName?: string;
  chunkTypes?: ChunkType[];
  severity?: "low" | "medium" | "high";
  urgency?: "low" | "medium" | "high" | "critical";
  limit?: number;
}

export function sanitiseListSessions(
  raw: ListSessionsRaw,
  userMessage: string,
  resolvedNames?: ResolvedNames
): ListSessionsRaw {
  const kept: ListSessionsRaw = {
    clientName: keepIfMentioned(raw.clientName, userMessage, resolvedNames?.clients),
    dateFrom: keepIfDate(raw.dateFrom, userMessage),
    dateTo: keepIfDate(raw.dateTo, userMessage),
    sentiment: keepCategorical(raw.sentiment, SENTIMENT_CUES, userMessage),
    themeName: keepIfMentioned(raw.themeName, userMessage, resolvedNames?.themes),
    chunkTypes: keepIfNonEmptyArray(raw.chunkTypes),
    severity: keepCategorical(raw.severity, SEVERITY_CUES, userMessage),
    urgency: keepCategorical(raw.urgency, URGENCY_CUES, userMessage),
    limit: raw.limit,
  };
  logIfChanged("list_sessions", raw, kept);
  return kept;
}

export interface ListThemesRaw {
  nameSearch?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export function sanitiseListThemes(
  raw: ListThemesRaw,
  userMessage: string
): ListThemesRaw {
  const kept: ListThemesRaw = {
    nameSearch: keepIfMentioned(raw.nameSearch, userMessage),
    dateFrom: keepIfDate(raw.dateFrom, userMessage),
    dateTo: keepIfDate(raw.dateTo, userMessage),
    limit: raw.limit,
  };
  logIfChanged("list_themes", raw, kept);
  return kept;
}

export interface SemanticSearchRaw {
  query: string;
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  chunkTypes?: ChunkType[];
}

export function sanitiseSemanticSearch(
  raw: SemanticSearchRaw,
  userMessage: string,
  resolvedNames?: ResolvedNames
): SemanticSearchRaw {
  const kept: SemanticSearchRaw = {
    query: raw.query, // required — pass through
    clientName: keepIfMentioned(raw.clientName, userMessage, resolvedNames?.clients),
    dateFrom: keepIfDate(raw.dateFrom, userMessage),
    dateTo: keepIfDate(raw.dateTo, userMessage),
    chunkTypes: keepIfNonEmptyArray(raw.chunkTypes),
  };
  logIfChanged("semantic_search", raw, kept);
  return kept;
}

export interface FetchSignalsRaw {
  clientName?: string;
  themeName?: string;
  chunkTypes?: ChunkType[];
  severity?: "low" | "medium" | "high";
  urgency?: "low" | "medium" | "high" | "critical";
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export function sanitiseFetchSignals(
  raw: FetchSignalsRaw,
  userMessage: string,
  resolvedNames?: ResolvedNames
): FetchSignalsRaw {
  const kept: FetchSignalsRaw = {
    clientName: keepIfMentioned(raw.clientName, userMessage, resolvedNames?.clients),
    themeName: keepIfMentioned(raw.themeName, userMessage, resolvedNames?.themes),
    chunkTypes: keepIfNonEmptyArray(raw.chunkTypes),
    severity: keepCategorical(raw.severity, SEVERITY_CUES, userMessage),
    urgency: keepCategorical(raw.urgency, URGENCY_CUES, userMessage),
    dateFrom: keepIfDate(raw.dateFrom, userMessage),
    dateTo: keepIfDate(raw.dateTo, userMessage),
    limit: raw.limit,
  };
  logIfChanged("fetch_signals", raw, kept);
  return kept;
}

export interface AggregateRaw {
  entity: "sessions" | "signals" | "clients";
  groupBy?: string | string[];
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  themeName?: string;
  chunkTypes?: string[];
  severity?: "low" | "medium" | "high";
  urgency?: "low" | "medium" | "high" | "critical";
  confidenceMin?: number;
}

export function sanitiseAggregate(
  raw: AggregateRaw,
  userMessage: string,
  resolvedNames?: ResolvedNames
): AggregateRaw {
  const kept: AggregateRaw = {
    entity: raw.entity, // required
    groupBy: raw.groupBy, // interpretive — leave alone
    clientName: keepIfMentioned(raw.clientName, userMessage, resolvedNames?.clients),
    dateFrom: keepIfDate(raw.dateFrom, userMessage),
    dateTo: keepIfDate(raw.dateTo, userMessage),
    themeName: keepIfMentioned(raw.themeName, userMessage, resolvedNames?.themes),
    chunkTypes: keepIfNonEmptyArray(raw.chunkTypes),
    severity: keepCategorical(raw.severity, SEVERITY_CUES, userMessage),
    urgency: keepCategorical(raw.urgency, URGENCY_CUES, userMessage),
    confidenceMin: keepConfidenceMin(raw.confidenceMin, userMessage),
  };
  logIfChanged("aggregate", raw, kept);
  return kept;
}

export interface TimeSeriesRaw {
  entity: "sessions" | "signals";
  granularity: "week" | "month";
  groupBy?: "theme";
  clientName?: string;
  dateFrom?: string;
  dateTo?: string;
  themeName?: string;
}

export function sanitiseTimeSeries(
  raw: TimeSeriesRaw,
  userMessage: string,
  resolvedNames?: ResolvedNames
): TimeSeriesRaw {
  // granularity is required and explicitly cued by the user's intent
  // (week/month). Don't drop it even if the user didn't say "weekly" —
  // the model has to pick one to satisfy the schema.
  const kept: TimeSeriesRaw = {
    entity: raw.entity,
    granularity: raw.granularity,
    groupBy: raw.groupBy,
    clientName: keepIfMentioned(raw.clientName, userMessage, resolvedNames?.clients),
    dateFrom: keepIfDate(raw.dateFrom, userMessage),
    dateTo: keepIfDate(raw.dateTo, userMessage),
    themeName: keepIfMentioned(raw.themeName, userMessage, resolvedNames?.themes),
  };
  // Granularity is a special case: GPT-4o tends to fill it with "month" by
  // default. If the user didn't mention any time bucket, force a sensible
  // default but log the substitution so we can see frequency.
  if (!mentions(userMessage, GRANULARITY_CUES)) {
    // No-op for now — the model is required to pass granularity to satisfy
    // the schema. Logging only.
    console.log(
      `${LOG_PREFIX} time_series — user message has no granularity cue; model chose: ${raw.granularity}`
    );
  }
  logIfChanged("time_series", raw, kept);
  return kept;
}
