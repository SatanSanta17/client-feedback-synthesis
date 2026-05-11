// ---------------------------------------------------------------------------
// Chat Prompt Caching — PRD-033 Part 3 / TRD § 3.4.
//
// Provider-aware wrapper that adds cache markers to the stable prefix
// (system message; tool descriptions are carried separately by the AI SDK
// and cached as part of the same provider-side prefix). The rest of the
// system never sees the difference — this helper centralises the per-
// provider dispatch.
//
// Provider-agnostic at the call site, provider-specific inside. Caching is
// one of the few features where providers fundamentally differ in protocol;
// Vercel AI SDK, LangChain, and Anthropic's own SDK docs all treat it the
// same way.
// ---------------------------------------------------------------------------

import type { ModelMessage } from "ai";

const LOG_PREFIX = "[chat-prompt-cache]";

const PROVIDER_ANTHROPIC = "anthropic";

/**
 * Per-turn cache telemetry, computed from the model response's normalised
 * `usage` object and logged alongside the existing `chat-complete` line.
 */
export interface CacheTelemetry {
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
}

/**
 * Applies provider-specific cache markers to the stable system message so
 * the system prompt + tool descriptions are billed at the cache-hit rate
 * on every turn after the first within a conversation.
 *
 * Behaviour by provider:
 * - **Anthropic** — adds an explicit `providerOptions.anthropic.cacheControl:
 *   { type: "ephemeral" }` marker to the system message. First-call cost
 *   slightly higher (cache write); subsequent calls within the 5-minute TTL
 *   bill cached tokens at ~10% of the normal input rate.
 * - **OpenAI** — caching is automatic for prompts ≥ 1024 tokens; nothing
 *   to add at request time. Cache-hit telemetry comes from the response
 *   `usage.cachedInputTokens` field (see `readCacheTelemetry` below).
 * - **Google Gemini** — explicit `createCachedContent` API call is NOT
 *   wired here (deferred; Google is not an active provider today —
 *   ARCHITECTURE.md "Deferred when Google becomes an active provider").
 *   Falls back to no-op.
 * - **Unknown / unsupported** — graceful no-op.
 */
export function applyPromptCacheMarkers(
  systemPrompt: string,
  history: ModelMessage[]
): ModelMessage[] {
  const provider = process.env.AI_PROVIDER ?? "";

  if (provider === PROVIDER_ANTHROPIC) {
    return [
      {
        role: "system",
        content: systemPrompt,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      ...history,
    ];
  }

  // OpenAI ("openai"): caching is automatic for prompts ≥ 1024 tokens; no
  //   marker needed at request time. Cache-hit telemetry comes from the
  //   response usage (see `readCacheTelemetry` below).
  // Google Gemini ("google"): explicit `createCachedContent` API call is
  //   NOT wired here — deferred until Google becomes an active provider
  //   (ARCHITECTURE.md "Deferred when Google becomes an active provider").
  // Unknown / other providers: graceful no-op.
  return [{ role: "system", content: systemPrompt }, ...history];
}

// ---------------------------------------------------------------------------
// Response-side telemetry
// ---------------------------------------------------------------------------

let observabilityGapWarned = false;

/**
 * Reads cache-hit / cache-miss input-token counts from a normalised AI SDK
 * usage object. SDK field shape has changed across versions; we try the
 * current path first, then fall back to the older nested path. If neither
 * is present, returns zeros and emits a one-time warning per process so the
 * observability gap is visible.
 *
 * Provider-neutral: Anthropic, OpenAI, and (eventually) Google all flow
 * through the AI SDK's `usage` normalisation.
 */
export function readCacheTelemetry(
  usage: Record<string, unknown> | undefined | null
): CacheTelemetry {
  if (!usage) return { cacheHitInputTokens: 0, cacheMissInputTokens: 0 };

  const inputTokens = typeof usage.inputTokens === "number" ? usage.inputTokens : 0;

  // Recent SDK shape — single field.
  if (typeof usage.cachedInputTokens === "number") {
    const hit = usage.cachedInputTokens;
    return {
      cacheHitInputTokens: hit,
      cacheMissInputTokens: Math.max(0, inputTokens - hit),
    };
  }

  // Older SDK shape (mirrors OpenAI's raw response).
  const details = usage.promptTokensDetails;
  if (details && typeof details === "object") {
    const cached = (details as Record<string, unknown>).cachedTokens;
    if (typeof cached === "number") {
      return {
        cacheHitInputTokens: cached,
        cacheMissInputTokens: Math.max(0, inputTokens - cached),
      };
    }
  }

  // Field not exposed by the active provider's SDK adapter.
  if (!observabilityGapWarned) {
    observabilityGapWarned = true;
    console.warn(
      `${LOG_PREFIX} cached-token count not exposed by the active provider's usage object — cache-hit telemetry will report 0. Provider: ${process.env.AI_PROVIDER ?? "(unset)"}`
    );
  }
  return { cacheHitInputTokens: 0, cacheMissInputTokens: inputTokens };
}
