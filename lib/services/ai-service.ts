import { generateText, generateObject, APICallError } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import {
  STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
  buildStructuredExtractionUserMessage,
} from "@/lib/prompts/structured-extraction";
import {
  extractionSchema,
  type ExtractedSignals,
} from "@/lib/schemas/extraction-schema";
import { renderExtractedSignalsToMarkdown } from "@/lib/utils/render-extracted-signals-to-markdown";
import {
  MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT,
  MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT,
  buildMasterSignalUserMessage,
} from "@/lib/prompts/master-signal-synthesis";
import type { PromptRepository } from "@/lib/repositories/prompt-repository";
import { getActivePrompt, getActivePromptVersion } from "@/lib/services/prompt-service";
import type { SignalSession } from "@/lib/types/signal-session";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

const EXTRACT_SIGNALS_MAX_TOKENS = 4096;
const MASTER_SIGNAL_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

type SupportedProvider = "anthropic" | "openai" | "google";

const PROVIDER_MAP: Record<SupportedProvider, (modelId: string) => LanguageModel> = {
  anthropic: (modelId) => anthropic(modelId),
  openai: (modelId) => openai(modelId),
  google: (modelId) => google(modelId),
};

/**
 * Reads AI_PROVIDER and AI_MODEL from environment variables and returns
 * the corresponding Vercel AI SDK model instance.
 */
function resolveModel(): { model: LanguageModel; label: string } {
  const provider = process.env.AI_PROVIDER;
  const modelId = process.env.AI_MODEL;

  if (!provider) {
    throw new AIConfigError("AI_PROVIDER environment variable is not set");
  }
  if (!modelId) {
    throw new AIConfigError("AI_MODEL environment variable is not set");
  }

  const factory = PROVIDER_MAP[provider as SupportedProvider];
  if (!factory) {
    throw new AIConfigError(
      `Unsupported AI_PROVIDER: "${provider}". Supported: ${Object.keys(PROVIDER_MAP).join(", ")}`
    );
  }

  return {
    model: factory(modelId),
    label: `${provider}/${modelId}`,
  };
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

/**
 * Result returned by extractSignals(), including the prompt version ID
 * so the caller can record which prompt produced the extraction (P1.R6).
 * PRD-018 P1.R5: extended with structuredJson (typed schema output).
 */
export interface ExtractionResult {
  structuredNotes: string;
  structuredJson: ExtractedSignals;
  promptVersionId: string | null;
}

/**
 * Extract signals from raw session notes via the configured AI model.
 * Uses generateObject() with extractionSchema to produce validated JSON.
 * The user's custom prompt (if active) is appended as extraction guidance —
 * it does not override the system prompt or output format (P1.R3).
 * Returns structured JSON, markdown (derived from JSON), and prompt version ID.
 * Retries transient failures (429, 5xx, network) with exponential backoff.
 */
export async function extractSignals(
  promptRepo: PromptRepository,
  rawNotes: string
): Promise<ExtractionResult> {
  // Fetch the user's custom prompt (if any) — used as guidance, not system prompt
  const activeVersion = await getActivePromptVersion(promptRepo, "signal_extraction");
  const customGuidance = activeVersion?.content ?? null;

  const userMessage = buildStructuredExtractionUserMessage(rawNotes, customGuidance);

  const structuredJson = await callModelObject({
    systemPrompt: STRUCTURED_EXTRACTION_SYSTEM_PROMPT,
    userMessage,
    schema: extractionSchema,
    maxTokens: EXTRACT_SIGNALS_MAX_TOKENS,
    operationName: "extractSignals",
  });

  // Derive markdown from JSON for backward compatibility (P1.R4)
  const structuredNotes = renderExtractedSignalsToMarkdown(structuredJson);

  return {
    structuredNotes,
    structuredJson,
    promptVersionId: activeVersion?.id ?? null,
  };
}

/**
 * Input for the master signal synthesis function.
 */
export interface MasterSignalInput {
  /** The previous master signal markdown. Null/undefined for cold start. */
  previousMasterSignal?: string | null;
  /** The session signals to incorporate. */
  sessions: SignalSession[];
}

/**
 * Synthesise a master signal document from individual session signals.
 *
 * - Cold start (no previousMasterSignal): synthesises from all provided sessions.
 * - Incremental (previousMasterSignal provided): merges new sessions into the
 *   existing master signal.
 *
 * Returns a markdown-formatted master signal document.
 * Retries transient failures with exponential backoff.
 */
export async function synthesiseMasterSignal(
  promptRepo: PromptRepository,
  input: MasterSignalInput
): Promise<string> {
  const { previousMasterSignal, sessions } = input;

  const isIncremental = !!previousMasterSignal;
  const promptKey = isIncremental
    ? "master_signal_incremental" as const
    : "master_signal_cold_start" as const;

  const dbPrompt = await getActivePrompt(promptRepo, promptKey);
  const systemPrompt = dbPrompt
    ?? (isIncremental
      ? MASTER_SIGNAL_INCREMENTAL_SYSTEM_PROMPT
      : MASTER_SIGNAL_COLD_START_SYSTEM_PROMPT);

  const userMessage = buildMasterSignalUserMessage(
    sessions,
    previousMasterSignal
  );

  console.log(
    `[ai-service] synthesiseMasterSignal — mode: ${isIncremental ? "incremental" : "cold start"}, sessions: ${sessions.length}`
  );

  return callModel({
    systemPrompt,
    userMessage,
    maxTokens: MASTER_SIGNAL_MAX_TOKENS,
    operationName: "synthesiseMasterSignal",
  });
}

// ---------------------------------------------------------------------------
// Shared retry logic with error classification
// ---------------------------------------------------------------------------

/**
 * Executes an async operation with retry logic for transient AI failures.
 * Classifies errors into non-retryable (config, quota, client) and retryable
 * (rate limit, server, network) categories. Used by both callModel and
 * callModelObject to avoid duplicating the retry/error logic.
 */
async function withRetry<T>(
  operationName: string,
  fn: (attempt: number) => Promise<T>
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Non-retryable errors — throw immediately
      if (err instanceof AIEmptyResponseError || err instanceof AIConfigError) {
        throw err;
      }

      // Quota / billing errors — don't retry, surface immediately
      if (
        APICallError.isInstance(err) &&
        (err.statusCode === 402 || err.statusCode === 403)
      ) {
        console.error(
          `[ai-service] ${operationName} — quota/billing error (${err.statusCode}):`,
          lastError.message
        );
        throw new AIQuotaError(
          `AI provider returned ${err.statusCode}: ${lastError.message}`
        );
      }

      // Don't retry other client errors (4xx except 429 rate limit)
      if (
        APICallError.isInstance(err) &&
        err.statusCode !== undefined &&
        err.statusCode < 500 &&
        err.statusCode !== 429
      ) {
        console.error(
          `[ai-service] ${operationName} — client error (not retrying):`,
          lastError.message
        );
        throw new AIRequestError(
          `Model rejected the request: ${lastError.message}`
        );
      }

      if (attempt >= MAX_RETRIES) {
        console.error(
          `[ai-service] ${operationName} — failed after ${attempt + 1} attempts:`,
          lastError.message
        );
        throw new AIServiceError(
          `${operationName} failed after ${attempt + 1} attempts: ${lastError.message}`
        );
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[ai-service] ${operationName} — retryable error (attempt ${attempt + 1}), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new AIServiceError(
    `${operationName} failed: ${lastError?.message ?? "unknown error"}`
  );
}

// ---------------------------------------------------------------------------
// Provider-agnostic model calls (text and object)
// ---------------------------------------------------------------------------

interface CallModelOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens: number;
  operationName: string;
}

/**
 * Calls the configured AI model via generateText() with retry logic.
 * Returns the text content from the response.
 */
async function callModel(options: CallModelOptions): Promise<string> {
  const { systemPrompt, userMessage, maxTokens, operationName } = options;
  const { model, label } = resolveModel();

  return withRetry(operationName, async (attempt) => {
    console.log(
      `[ai-service] ${operationName} — attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${label}`
    );

    const { text } = await generateText({
      model,
      system: systemPrompt,
      prompt: userMessage,
      maxOutputTokens: maxTokens,
    });

    if (!text.trim()) {
      throw new AIEmptyResponseError("Model returned an empty response");
    }

    console.log(
      `[ai-service] ${operationName} — success, ${text.length} chars`
    );
    return text;
  });
}

interface CallModelObjectOptions {
  systemPrompt: string;
  userMessage: string;
  schema: typeof extractionSchema;
  maxTokens: number;
  operationName: string;
}

/**
 * Calls the configured AI model via generateObject() with retry logic.
 * Returns the validated object conforming to the extraction schema.
 */
async function callModelObject(
  options: CallModelObjectOptions
): Promise<ExtractedSignals> {
  const { systemPrompt, userMessage, schema, maxTokens, operationName } = options;
  const { model, label } = resolveModel();

  return withRetry(operationName, async (attempt) => {
    console.log(
      `[ai-service] ${operationName} — attempt ${attempt + 1}/${MAX_RETRIES + 1}, model: ${label}, mode: generateObject`
    );

    const { object } = await generateObject({
      model,
      system: systemPrompt,
      prompt: userMessage,
      schema,
      maxOutputTokens: maxTokens,
    });

    console.log(
      `[ai-service] ${operationName} — success (generateObject)`
    );
    return object;
  });
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class AIServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIServiceError";
  }
}

export class AIEmptyResponseError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIEmptyResponseError";
  }
}

export class AIRequestError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIRequestError";
  }
}

export class AIQuotaError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIQuotaError";
  }
}

export class AIConfigError extends AIServiceError {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}
