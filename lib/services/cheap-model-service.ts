import { APICallError, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";

// ---------------------------------------------------------------------------
// Cheap-Model Service — PRD-033 Part 2.
// Independent provider/model resolution for the map step of summarise_sessions
// (and any future cheap-model fan-out work). Deliberately separate from
// resolveModel() in ai-service.ts: PRD P2.R2 forbids implicit fallback from
// one to the other, so each is configured in isolation.
// ---------------------------------------------------------------------------

const LOG_PREFIX = "[cheap-model-service]";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SummaryProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SummaryProviderConfigError";
  }
}

// ---------------------------------------------------------------------------
// Provider resolution (mirrors ai-service.ts.resolveModel)
// ---------------------------------------------------------------------------

type SupportedProvider = "anthropic" | "openai" | "google";

const PROVIDER_MAP: Record<
  SupportedProvider,
  (modelId: string) => LanguageModel
> = {
  anthropic: (modelId) => anthropic(modelId),
  openai: (modelId) => openai(modelId),
  google: (modelId) => google(modelId),
};

/**
 * Reads SUMMARY_AI_PROVIDER and SUMMARY_AI_MODEL from environment variables
 * and returns the corresponding Vercel AI SDK model instance. Throws lazily
 * (on first call) rather than at boot so the rest of the chat surface
 * functions normally even if the cheap model is misconfigured.
 */
export function resolveCheapModel(): { model: LanguageModel; label: string } {
  const provider = process.env.SUMMARY_AI_PROVIDER;
  const modelId = process.env.SUMMARY_AI_MODEL;

  if (!provider) {
    throw new SummaryProviderConfigError(
      "SUMMARY_AI_PROVIDER is not set — required for summarise_sessions tool. Cheap-model and chat-model env vars are deliberately independent (no fallback)."
    );
  }
  if (!modelId) {
    throw new SummaryProviderConfigError(
      "SUMMARY_AI_MODEL is not set — required for summarise_sessions tool."
    );
  }

  const factory = PROVIDER_MAP[provider as SupportedProvider];
  if (!factory) {
    throw new SummaryProviderConfigError(
      `Unsupported SUMMARY_AI_PROVIDER: "${provider}". Supported: ${Object.keys(PROVIDER_MAP).join(", ")}`
    );
  }

  return {
    model: factory(modelId),
    label: `${provider}/${modelId}`,
  };
}

// ---------------------------------------------------------------------------
// Retry helper — mirrors withEmbeddingRetry in embedding-service.ts.
// 3 retries, exponential backoff (1s, 2s, 4s), Retry-After honoured for 429,
// no retry for 4xx other than 429.
// ---------------------------------------------------------------------------

function readStatusCode(err: unknown): number | undefined {
  if (err instanceof APICallError) {
    return err.statusCode;
  }
  // Duck-type for SDKs that surface `status` on their error subclasses.
  if (err && typeof err === "object" && "status" in err) {
    const s = (err as { status: unknown }).status;
    if (typeof s === "number") return s;
  }
  if (err && typeof err === "object" && "statusCode" in err) {
    const s = (err as { statusCode: unknown }).statusCode;
    if (typeof s === "number") return s;
  }
  return undefined;
}

function readRetryAfterMs(err: unknown): number | null {
  // APICallError exposes the underlying response headers via its
  // responseHeaders field. Other AI-SDK error subclasses use the same shape.
  if (err && typeof err === "object" && "responseHeaders" in err) {
    const headers = (err as { responseHeaders: unknown }).responseHeaders;
    if (headers && typeof headers === "object") {
      const value =
        (headers as Record<string, string>)["retry-after"] ??
        (headers as Record<string, string>)["Retry-After"];
      if (value) {
        const seconds = parseFloat(value);
        if (!isNaN(seconds) && seconds > 0) return seconds * 1000;
      }
    }
  }
  return null;
}

export async function withCheapModelRetry<T>(
  operationName: string,
  fn: () => Promise<T>
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Config errors are non-retryable — surface immediately.
      if (err instanceof SummaryProviderConfigError) throw err;

      const statusCode = readStatusCode(err);

      // Don't retry 4xx other than 429 (auth, validation, model-not-found).
      if (
        statusCode !== undefined &&
        statusCode < 500 &&
        statusCode !== 429
      ) {
        console.error(
          `${LOG_PREFIX} ${operationName} — client error (${statusCode}, not retrying):`,
          lastError.message
        );
        throw lastError;
      }

      if (attempt >= MAX_RETRIES) {
        console.error(
          `${LOG_PREFIX} ${operationName} — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw lastError;
      }

      const retryAfterMs =
        statusCode === 429 ? readRetryAfterMs(err) : null;
      const delay =
        retryAfterMs ?? INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);

      console.warn(
        `${LOG_PREFIX} ${operationName} — retryable error (status: ${statusCode ?? "?"}, attempt ${attempt + 1}), retrying in ${delay}ms:`,
        lastError.message
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error(`${operationName} failed after retries`);
}
